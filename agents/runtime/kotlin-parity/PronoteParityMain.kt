// PronoteParityMain.kt — pilote JSON du harnais de parité protocole (#200, #202).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-pronote-parity.test.ts`
// (jamais par Gradle, jamais dans l'APK). Protocole : une opération JSON par
// ligne sur stdin, une réponse par ligne sur stdout, rendues avec le `Json`
// embarqué lui-même (le pilote mange donc son propre chien : `jsonEcho`
// valide le parseur/sérialiseur contre `JSON.parse`/`JSON.stringify`).
//
// Les réponses d'erreur du PORT (`CryptoError`, `PronoteAPIError`,
// `ExpiredObject`, `JsonError`) sont capturées en `{"error", "message"}` :
// NOM et message comparés à la référence. Les erreurs du PILOTE (op inconnue,
// entrée malformée) sortent aussi en `{"error"…}` mais préfixées `pilote: `
// dans `message` — le test les refuse (une entrée malformée n'est pas un
// résultat).
//
// États persistants (sessions HTTP, communications) : indexés par `sid`/`cid`
// alloués par le pilote, comme les `CookieJar` injectés côté TS.
package fr.veryslopnynotes.pronoteparity

import fr.veryslopnynotes.pronote.Communication
import fr.veryslopnynotes.pronote.CookieJar
import fr.veryslopnynotes.pronote.DecryptionChange
import fr.veryslopnynotes.pronote.Encryption
import fr.veryslopnynotes.pronote.HttpSession
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.KeepAlive
import fr.veryslopnynotes.pronote.enBytes
import fr.veryslopnynotes.pronote.enleverAlea
import fr.veryslopnynotes.pronote.hexToBytes
import fr.veryslopnynotes.pronote.md5
import fr.veryslopnynotes.pronote.prepareOnglets
import fr.veryslopnynotes.pronote.sha256HexUpper
import fr.veryslopnynotes.pronote.toHexLower
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun JVal.Obj.obj(key: String): JVal.Obj? = fields[key] as? JVal.Obj

private fun JVal.Obj.arr(key: String): List<JVal>? = (fields[key] as? JVal.Arr)?.items

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    private var nextId = 1
    private val jars = mutableMapOf<Int, CookieJar>()
    private val sessions = mutableMapOf<Int, HttpSession>()
    private val comms = mutableMapOf<Int, Communication>()

    private fun alloc(): Int = nextId++

    fun run(op: JVal.Obj): JVal {
        return when (op.str("op")) {
            // --- Json embarqué (mangé par son propre chien) ------------------
            "jsonEcho" -> Json.parse(op.str("text") ?: throw IllegalArgumentException("opération inconnue : ${op.str("op")}"))
            // --- Crypto ------------------------------------------------------
            "md5" -> ok("hex" to JVal.Str(md5((op.str("dataHex") ?: "").hexToBytes()).toHexLower()))
            "sha256" -> ok("hex" to JVal.Str(sha256HexUpper(op.str("text") ?: "")))
            "aes" -> {
                val enc = Encryption()
                enc.aesKey = (op.str("keyHex") ?: "").hexToBytes()
                enc.aesIv = (op.str("ivHex") ?: "").hexToBytes()
                val data = (op.str("dataHex") ?: "").hexToBytes()
                if (op.str("mode") == "decrypt") {
                    ok("hex" to JVal.Str(enc.aesDecrypt(data).toHexLower()))
                } else {
                    ok("hex" to JVal.Str(enc.aesEncrypt(data).toHexLower()))
                }
            }
            "aesDefaults" -> {
                // Clé/IV par défaut (md5(vide), zéros) : déterministe des deux côtés.
                val enc = Encryption()
                val data = (op.str("dataHex") ?: "").hexToBytes()
                if (op.str("mode") == "decrypt") {
                    ok("hex" to JVal.Str(enc.aesDecrypt(data).toHexLower()))
                } else {
                    ok("hex" to JVal.Str(enc.aesEncrypt(data).toHexLower()))
                }
            }
            "aesSetIvNull" -> {
                val enc = Encryption()
                enc.aesIvTemp = (op.str("tempHex") ?: "").hexToBytes()
                enc.aesSetIv(null)
                ok("iv" to JVal.Str(enc.aesIv.toHexLower()))
            }
            "aesIvTemp" -> {
                // Le temporaire aléatoire, pour prouver qu'on peut le fixer.
                ok("hex" to JVal.Str(Encryption().aesIvTemp.toHexLower()))
            }
            "rsa" -> ok("hex" to JVal.Str(Encryption().rsaEncrypt((op.str("dataHex") ?: "").hexToBytes()).toHexLower()))
            // RSA brut (sans bourrage) : le test fournit le bloc EM complet
            // (donc déterministe) et revérifie l'exponentiation par lui-même —
            // c'est ce qui prouve la clé + le moteur JCE, le bourrage PKCS#1
            // aléatoire étant inverifiable hors serveur (voir le test).
            "rsaNoPad" -> {
                val spec = java.security.spec.RSAPublicKeySpec(Encryption.RSA_1024_MODULUS, Encryption.RSA_1024_EXPONENT)
                val publicKey = java.security.KeyFactory.getInstance("RSA").generatePublic(spec)
                val cipher = javax.crypto.Cipher.getInstance("RSA/ECB/NoPadding")
                cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, publicKey)
                ok("hex" to JVal.Str(cipher.doFinal((op.str("emHex") ?: "").hexToBytes()).toHexLower()))
            }
            // Constantes de la clé, pour prouver qu'elles arrivent intactes
            // (le bourrage aléatoire interdit toute autre comparaison exacte).
            "rsaKey" -> ok(
                "n" to JVal.Str(Encryption.RSA_1024_MODULUS.toString()),
                "e" to JVal.Str(Encryption.RSA_1024_EXPONENT.toString()),
            )
            // --- Fonctions pures ----------------------------------------------
            "enleverAlea" -> ok("value" to JVal.Str(enleverAlea(op.str("text") ?: "")))
            "enBytes" -> ok("hex" to JVal.Str(enBytes(op.str("text") ?: "").toHexLower()))
            "prepareOnglets" -> ok(
                "value" to JVal.Arr(prepareOnglets(op.fields["value"]).map { JVal.Num(it) }),
            )
            "parseHtml" -> {
                val comm = Communication("http://127.0.0.1/x", null, false)
                try {
                    val attrs = comm.parseHtml(op.str("html") ?: "")
                    ok(
                        "ok" to JVal.Bool(true),
                        "attrs" to JVal.Obj(LinkedHashMap(attrs.mapValues { (_, v) -> JVal.Str(v) as JVal })),
                    )
                } catch (e: Exception) {
                    ok("ok" to JVal.Bool(false), "error" to JVal.Str(e.javaClass.simpleName))
                }
            }
            // --- Jar à cookies -------------------------------------------------
            "cookieNew" -> {
                val sid = alloc()
                jars[sid] = CookieJar()
                ok("sid" to JVal.Num(sid.toDouble()))
            }
            "cookieSet" -> {
                val jar = jars[(op.num("sid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: sid inconnu")
                jar.setCookie(op.str("header") ?: "", op.str("url") ?: "")
                ok("ok" to JVal.Bool(true))
            }
            "cookieGet" -> {
                val jar = jars[(op.num("sid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: sid inconnu")
                ok("value" to JVal.Str(jar.getCookieString(op.str("url") ?: "")))
            }
            // --- Session HTTP ---------------------------------------------------
            "httpNew" -> {
                val sid = alloc()
                val headers = op.obj("headers")?.fields?.mapValues { (_, v) -> (v as JVal.Str).value } ?: emptyMap()
                sessions[sid] = HttpSession(headers)
                ok("sid" to JVal.Num(sid.toDouble()))
            }
            "httpReq" -> {
                val session = sessions[(op.num("sid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: sid inconnu")
                val opts = op.obj("opts")
                val res = session.request(
                    op.str("method") ?: "GET",
                    op.str("url") ?: "",
                    fr.veryslopnynotes.pronote.RequestOpts(
                        params = opts?.obj("params")?.fields?.mapValues { (_, v) -> (v as JVal.Str).value },
                        headers = opts?.obj("headers")?.fields?.mapValues { (_, v) -> (v as JVal.Str).value },
                        json = opts?.fields?.get("json"),
                        data = opts?.obj("data")?.fields?.mapValues { (_, v) -> (v as? JVal.Str)?.value },
                    ),
                )
                ok(
                    "status" to JVal.Num(res.status.toDouble()),
                    "ok" to JVal.Bool(res.ok),
                    "url" to JVal.Str(res.url),
                    "headers" to JVal.Obj(
                        LinkedHashMap(res.headers.mapValues { (_, vs) -> JVal.Arr(vs.map { JVal.Str(it) }) as JVal }),
                    ),
                    "text" to JVal.Str(res.text),
                )
            }
            "httpSeq" -> {
                // N requêtes séquentielles sur la MÊME session (#309) : le
                // serveur factice doit voir UN SEUL port distant si le socket
                // retourne au cache keep-alive. Renvoie les statuts (sanity).
                val session = sessions[(op.num("sid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: sid inconnu")
                val url = op.str("url") ?: ""
                val n = (op.num("n") ?: 0.0).toInt()
                val statuses = (1..n).map { session.get(url).status }
                ok("statuses" to JVal.Arr(statuses.map { JVal.Num(it.toDouble()) }))
            }
            // --- Communication ---------------------------------------------------
            "commNew" -> {
                val cid = alloc()
                comms[cid] = Communication(op.str("site") ?: "", null, op.bool("mobile") == true)
                ok("cid" to JVal.Num(cid.toDouble()))
            }
            "commSeed" -> {
                // Fixe l'aléa de handshake (test uniquement : rend le fil
                // octet-comparable ; le réel reste aléatoire).
                val comm = comms[(op.num("cid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: cid inconnu")
                comm.encryption.aesIvTemp = (op.str("tempHex") ?: "").hexToBytes()
                ok("ok" to JVal.Bool(true))
            }
            "commInit" -> {
                val comm = comms[(op.num("cid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: cid inconnu")
                val id = op.str("identifier")
                val (attrs, response) = comm.initialise(id)
                ok(
                    "attributes" to JVal.Obj(LinkedHashMap(attrs.mapValues { (_, v) -> JVal.Str(v) as JVal })),
                    "response" to response,
                )
            }
            "commPost" -> {
                val comm = comms[(op.num("cid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: cid inconnu")
                val data = op.obj("data")?.fields ?: emptyMap()
                val dc = op.obj("decryptionChange")
                val out = comm.post(
                    op.str("function") ?: "",
                    data,
                    dc?.let {
                        DecryptionChange(
                            iv = it.str("ivHex")?.hexToBytes(),
                            key = it.str("keyHex")?.hexToBytes(),
                        )
                    },
                )
                out
            }
            "commAfterAuth" -> {
                val comm = comms[(op.num("cid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: cid inconnu")
                comm.afterAuth(
                    op.fields["data"] ?: throw IllegalArgumentException("pilote: data absent"),
                    (op.str("authKeyHex") ?: "").hexToBytes(),
                )
                ok("ok" to JVal.Bool(true))
            }
            "commSetOnglets" -> {
                val comm = comms[(op.num("cid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: cid inconnu")
                comm.authorizedOnglets = op.arr("onglets")?.map { (it as JVal.Num).value } ?: emptyList()
                ok("ok" to JVal.Bool(true))
            }
            "commState" -> {
                val comm = comms[(op.num("cid") ?: 0.0).toInt()] ?: throw IllegalArgumentException("pilote: cid inconnu")
                ok(
                    "requestNumber" to JVal.Num(comm.requestNumber.toDouble()),
                    "encryptRequests" to JVal.Bool(comm.encryptRequests),
                    "compressRequests" to JVal.Bool(comm.compressRequests),
                )
            }
            // --- KeepAlive --------------------------------------------------------
            "keepAlive" -> {
                // `staleSec` : ancienneté simulée du dernier ping ; `runMs` :
                // durée d'écoute. Renvoie le nombre de pings (seuils, pas exact).
                val lastPing = System.currentTimeMillis() / 1000 - ((op.num("staleSec") ?: 0.0).toLong())
                var pings = 0
                val ka = KeepAlive(
                    shouldPing = { System.currentTimeMillis() / 1000 - lastPing >= 110 },
                    ping = { pings++ },
                )
                ka.start()
                Thread.sleep(((op.num("runMs") ?: 0.0).toLong()))
                ka.stop()
                ok("pings" to JVal.Num(pings.toDouble()))
            }
            else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
        }
    }
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    val driver = Driver()
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(driver.run(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            // Erreur du PORT : nom + message comparés à la référence.
            // Erreur du PILOTE : préfixée `pilote: `, refusée par le test.
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
