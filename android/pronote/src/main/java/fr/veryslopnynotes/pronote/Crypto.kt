package fr.veryslopnynotes.pronote

import java.math.BigInteger
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.spec.RSAPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-128-CBC pour la session, RSA-1024 PKCS#1 v1.5 pour le handshake — via
 * `javax.crypto`, sur API 26. Clé publique RSA codée en dur, comme
 * `pronotepy`/`pronotets`.
 */

fun md5(data: ByteArray): ByteArray = MessageDigest.getInstance("MD5").digest(data)

/**
 * Bourrage PKCS#7 manuel, un bloc ENTIER si déjà aligné. Utilisé AVANT
 * `aesEncrypt` (qui bourre une seconde fois) pour les URL magiques
 * `FichiersExternes` : les deux couches font partie du protocole.
 */
fun pkcs7Pad(data: ByteArray, blockSize: Int = 16): ByteArray {
    val padLen = blockSize - (data.size % blockSize)
    return data + ByteArray(padLen) { padLen.toByte() }
}

fun sha256HexUpper(data: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(data.toByteArray(Charsets.UTF_8))
    return digest.toHexLower().uppercase()
}

class Encryption {
    companion object {
        // Clé prise de eleve.js — même constante que pronotepy/pronotets.
        val RSA_1024_MODULUS = BigInteger(
            "130337874517286041778445012253514395801341480334668979416920989365464528904618150245388048105865059387076357492684573172203245221386376405947824377827224846860699130638566643129067735803555082190977267155957271492183684665050351182476506458843580431717209261903043895605014125081521285387341454154194253026277",
        )
        val RSA_1024_EXPONENT = BigInteger("65537")
    }

    var aesIv: ByteArray = ByteArray(16)
    var aesIvTemp: ByteArray = ByteArray(16).also { SecureRandom().nextBytes(it) }
    var aesKey: ByteArray = md5(ByteArray(0))

    fun aesEncrypt(data: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aesKey, "AES"), IvParameterSpec(aesIv))
        return cipher.doFinal(data)
    }

    fun aesDecrypt(data: ByteArray): ByteArray {
        try {
            val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey, "AES"), IvParameterSpec(aesIv))
            return cipher.doFinal(data)
        } catch (e: Exception) {
            throw CryptoError("Decryption failed while trying to un pad. (probably bad decryption key/iv)")
        }
    }

    /** `null` = IV dérivé du temporaire (`md5(aesIvTemp)`), comme côté TS. */
    fun aesSetIv(iv: ByteArray?) {
        aesIv = iv ?: md5(aesIvTemp)
    }

    /** `null` = inchangé (le TS teste la vérité de l'objet, jamais vide). */
    fun aesSetKey(key: ByteArray?) {
        if (key != null) aesKey = md5(key)
    }

    /** PKCS#1 v1.5 contre la clé publique codée en dur (aléatoire par conception). */
    fun rsaEncrypt(data: ByteArray): ByteArray {
        val spec = RSAPublicKeySpec(RSA_1024_MODULUS, RSA_1024_EXPONENT)
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(spec)
        val cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding")
        cipher.init(Cipher.ENCRYPT_MODE, publicKey)
        return cipher.doFinal(data)
    }
}
