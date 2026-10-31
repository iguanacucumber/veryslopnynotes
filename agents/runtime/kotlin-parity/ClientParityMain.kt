// ClientParityMain.kt — pilote JSON de la parité client + données.
package fr.veryslopnynotes.clientparity

import fr.veryslopnynotes.pronote.Absence
import fr.veryslopnynotes.pronote.Attachment
import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.ClientInfo
import fr.veryslopnynotes.pronote.ClientOptions
import fr.veryslopnynotes.pronote.CookieJar
import fr.veryslopnynotes.pronote.Delay
import fr.veryslopnynotes.pronote.Discussion
import fr.veryslopnynotes.pronote.Grade
import fr.veryslopnynotes.pronote.Homework
import fr.veryslopnynotes.pronote.InfoFilter
import fr.veryslopnynotes.pronote.Information
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.Lesson
import fr.veryslopnynotes.pronote.LessonContent
import fr.veryslopnynotes.pronote.Menu
import fr.veryslopnynotes.pronote.Message
import fr.veryslopnynotes.pronote.Period
import fr.veryslopnynotes.pronote.Punishment
import fr.veryslopnynotes.pronote.QrCode
import fr.veryslopnynotes.pronote.QrLoginOptions
import fr.veryslopnynotes.pronote.Recipient
import fr.veryslopnynotes.pronote.Average
import fr.veryslopnynotes.pronote.Subject
import fr.veryslopnynotes.pronote.boolOf
import fr.veryslopnynotes.pronote.datetimeParse
import fr.veryslopnynotes.pronote.dateParse
import fr.veryslopnynotes.pronote.frDate
import fr.veryslopnynotes.pronote.gradeParse
import fr.veryslopnynotes.pronote.hexToBytes
import fr.veryslopnynotes.pronote.toHexLower
import fr.veryslopnynotes.pronote.htmlParse
import fr.veryslopnynotes.pronote.numOf
import fr.veryslopnynotes.pronote.place2time
import fr.veryslopnynotes.pronote.strOf
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime
import java.time.ZoneId

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value
private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value
private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value
private fun JVal.Obj.obj(key: String): JVal.Obj? = fields[key] as? JVal.Obj
private fun JVal.Obj.arr(key: String): List<JVal>? = (fields[key] as? JVal.Arr)?.items

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Millis zone-système (même conteneur des deux côtés : instants comparables). */
private fun millis(d: LocalDateTime): JVal.Num =
    JVal.Num(d.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli().toDouble())

/** ISO zoné (`Z`) → heure murale système (comme `new Date` côté TS). */
private fun parseDt(s: String?): LocalDateTime =
    java.time.OffsetDateTime.parse(s).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime()

/** Objet rendu : `null` = clé omise (règle `undefined`), `JVal.Null` = `null` gardé. */
private class Render(private val map: LinkedHashMap<String, JVal?> = LinkedHashMap()) {
    fun put(key: String, v: JVal?) {
        if (v != null) map[key] = v
    }
    fun putStr(key: String, v: String?) = put(key, v?.let { JVal.Str(it) })
    fun putNum(key: String, v: Double?) = put(key, v?.let { JVal.Num(it) })
    fun putBool(key: String, v: Boolean) = put(key, JVal.Bool(v))
    fun putDate(key: String, v: LocalDateTime?) = put(key, v?.let { millis(it) })
    fun build(): JVal.Obj {
        val out = LinkedHashMap<String, JVal>()
        for ((k, v) in map) if (v != null) out[k] = v
        return JVal.Obj(out)
    }
}


private fun renderSubject(s: Subject): JVal.Obj {
    val r = Render()
    r.putStr("id", s.id)
    r.putStr("name", s.name)
    r.putBool("groups", s.groups)
    return r.build()
}

private fun renderAverage(a: Average): JVal.Obj {
    val r = Render()
    r.putStr("student", a.student)
    r.putStr("outOf", a.outOf)
    r.putStr("defaultOutOf", a.defaultOutOf)
    r.putStr("classAverage", a.classAverage)
    r.putStr("min", a.min)
    r.putStr("max", a.max)
    r.put("subject", renderSubject(a.subject))
    r.putStr("backgroundColor", a.backgroundColor)
    return r.build()
}

private fun renderGrade(g: Grade): JVal.Obj {
    val r = Render()
    r.putStr("id", g.id)
    r.putStr("grade", g.grade)
    r.putStr("outOf", g.outOf)
    r.putStr("defaultOutOf", g.defaultOutOf)
    r.putDate("date", g.date)
    r.put("subject", renderSubject(g.subject))
    if (g.period != null) r.putStr("periodId", g.period.id)
    r.putStr("average", g.average)
    r.putStr("max", g.max)
    r.putStr("min", g.min)
    r.putStr("coefficient", g.coefficient)
    r.putStr("comment", g.comment)
    r.putBool("isBonus", g.isBonus)
    r.putBool("isOptionnal", g.isOptionnal)
    r.putBool("isOutOf20", g.isOutOf20)
    return r.build()
}

private fun renderAbsence(a: Absence): JVal.Obj {
    val r = Render()
    r.putStr("id", a.id)
    r.putDate("fromDate", a.fromDate)
    r.putDate("toDate", a.toDate)
    r.putBool("justified", a.justified)
    r.putStr("hours", a.hours)
    r.putNum("days", a.days)
    r.put("reasons", JVal.Arr(a.reasons.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    return r.build()
}

private fun renderDelay(d: Delay): JVal.Obj {
    val r = Render()
    r.putStr("id", d.id)
    r.putDate("date", d.date)
    r.putNum("minutes", d.minutes)
    r.putBool("justified", d.justified)
    r.putStr("justification", d.justification)
    r.put("reasons", JVal.Arr(d.reasons.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    return r.build()
}

private fun renderPunishment(p: Punishment): JVal.Obj {
    val r = Render()
    r.putStr("id", p.id)
    r.putBool("during_lesson", p.during_lesson)
    r.putDate("given", p.given)
    r.putBool("exclusion", p.exclusion)
    r.putStr("homework", p.homework)
    r.put("homeworkDocuments", JVal.Arr(p.homeworkDocuments.map { renderAttachment(it) }))
    r.putStr("circumstances", p.circumstances)
    r.put("circumstanceDocuments", JVal.Arr(p.circumstanceDocuments.map { renderAttachment(it) }))
    r.putStr("nature", p.nature)
    r.putStr("requiresParent", p.requiresParent)
    r.put("reasons", JVal.Arr(p.reasons.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.putStr("giver", p.giver)
    r.putBool("schedulable", p.schedulable)
    r.put("schedule", JVal.Arr(p.schedule.map { sp ->
        val q = Render()
        q.putStr("id", sp.id)
        q.putDate("start", sp.start)
        q.putNum("duration", sp.duration)
        q.build()
    }))
    r.putNum("duration", p.duration)
    return r.build()
}

private fun renderAttachment(a: Attachment): JVal.Obj {
    val r = Render()
    r.putStr("name", a.name)
    r.putStr("id", a.id)
    r.putNum("type", a.type)
    r.putStr("url", a.url)
    return r.build()
}

private fun renderLesson(l: Lesson): JVal.Obj {
    val r = Render()
    r.putStr("id", l.id)
    r.putBool("canceled", l.canceled)
    r.putStr("status", l.status)
    r.putStr("memo", l.memo)
    r.putStr("backgroundColor", l.backgroundColor)
    r.putBool("outing", l.outing)
    r.putDate("start", l.start)
    r.putBool("exempted", l.exempted)
    r.put("virtualClassrooms", JVal.Arr(l.virtualClassrooms.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.putNum("num", l.num)
    r.putBool("detention", l.detention)
    r.putBool("test", l.test)
    r.putDate("end", l.end)
    // `subject` absent = `null` explicite (jamais omis) ; idem noms jointifs.
    r.put("subject", l.subject?.let { renderSubject(it) } ?: JVal.Null)
    r.put("teacherNames", JVal.Arr(l.teacherNames.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.put("classrooms", JVal.Arr(l.classrooms.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.put("groupNames", JVal.Arr(l.groupNames.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.put("teacherName", l.teacherName?.let { JVal.Str(it) } ?: JVal.Null)
    r.put("classroom", l.classroom?.let { JVal.Str(it) } ?: JVal.Null)
    r.put("groupName", l.groupName?.let { JVal.Str(it) } ?: JVal.Null)
    // `normal` est un getter (jamais sérialisé côté TS) : non rendu, comme `date`/`close`.
    return r.build()
}

private fun renderLessonContent(c: LessonContent): JVal.Obj {
    val r = Render()
    r.putStr("title", c.title)
    r.putStr("description", c.description)
    r.putStr("category", c.category)
    return r.build()
}

private fun renderHomework(h: Homework): JVal.Obj {
    val r = Render()
    r.putStr("id", h.id)
    r.putStr("description", h.description)
    r.putBool("done", h.done)
    r.put("subject", renderSubject(h.subject))
    r.putDate("date", h.date)
    r.putStr("backgroundColor", h.backgroundColor)
    return r.build()
}

private fun renderInformation(i: Information): JVal.Obj {
    val r = Render()
    r.putStr("id", i.id)
    r.putStr("title", i.title)
    r.putStr("author", i.author)
    r.putBool("read", i.read)
    r.putDate("creationDate", i.creationDate)
    r.putDate("startDate", i.startDate)
    r.putDate("endDate", i.endDate)
    r.putStr("category", i.category)
    r.putBool("survey", i.survey)
    r.putBool("template", i.template)
    r.putBool("sharedTemplate", i.sharedTemplate)
    r.putBool("anonymousResponse", i.anonymousResponse)
    return r.build()
}

private fun renderRecipient(p: Recipient): JVal.Obj {
    val r = Render()
    r.putStr("id", p.id)
    r.putStr("name", p.name)
    r.putStr("type", p.type)
    r.putStr("email", p.email)
    r.put("functions", JVal.Arr(p.functions.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.putBool("withDiscussion", p.withDiscussion)
    return r.build()
}

private fun renderMessage(m: Message): JVal.Obj {
    val r = Render()
    r.putStr("id", m.id)
    r.put("author", m.author?.let { JVal.Str(it) } ?: JVal.Null)
    r.putBool("seen", m.seen)
    r.putDate("created", m.created)
    // Alias obsolète, même instant (rendu pour que `dateParse` y soit couvert, C7).
    r.putDate("date", m.created)
    r.putStr("content", m.content)
    r.put("replyingTo", m.replyingTo?.let { JVal.Str(it.id) } ?: JVal.Null)
    return r.build()
}

private fun renderDiscussion(d: Discussion): JVal.Obj {
    val r = Render()
    r.putStr("id", d.id)
    r.putStr("subject", d.subject)
    r.putStr("creator", d.creator)
    r.putNum("unread", d.unread)
    r.putBool("closed", d.closed)
    r.putBool("close", d.close)
    r.put("labels", JVal.Arr(d.labels.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.putBool("replyable", d.replyable)
    return r.build()
}

private fun renderMenu(m: Menu): JVal.Obj {
    val r = Render()
    r.putStr("id", m.id)
    r.putStr("name", m.name)
    r.putDate("date", m.date)
    r.putBool("isLunch", m.isLunch)
    r.putBool("isDinner", m.isDinner)
    fun foods(fs: List<Menu.Food>?): JVal? = fs?.let { list ->
        JVal.Arr(list.map { f ->
            val q = Render()
            q.putStr("id", f.id)
            q.putStr("name", f.name)
            q.put("labels", JVal.Arr(f.labels.map { lb ->
                val w = Render()
                w.putStr("id", lb.id)
                w.putStr("name", lb.name)
                w.putStr("color", lb.color)
                w.build()
            }))
            q.build()
        })
    }
    r.put("firstMeal", foods(m.firstMeal))
    r.put("mainMeal", foods(m.mainMeal))
    r.put("sideMeal", foods(m.sideMeal))
    r.put("otherMeal", foods(m.otherMeal))
    r.put("cheese", foods(m.cheese))
    r.put("dessert", foods(m.dessert))
    return r.build()
}

private fun renderClientInfo(c: ClientInfo): JVal.Obj {
    val r = Render()
    r.putStr("id", c.id)
    r.putStr("name", c.name)
    r.putStr("className", c.className)
    r.putStr("establishment", c.establishment)
    r.put("delegue", JVal.Arr(c.delegue.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }))
    r.put("profilePicture", c.profilePicture?.let { renderAttachment(it) } ?: JVal.Null)
    return r.build()
}


private fun JVal.Obj.reqStr(key: String): String = (fields[key] as? JVal.Str)?.value
    ?: throw IllegalArgumentException("pilote: $key texte attendu")

private class ClientDriver {
    private var nextId = 1
    private val clients = mutableMapOf<Int, Client>()

    private fun client(cid: Double?): Client =
        clients[cid?.toInt()] ?: throw IllegalArgumentException("pilote: cid inconnu")

    private fun periodOf(client: Client, periodId: String?): Period {
        val periods = client.periods
        return periods.firstOrNull { it.id == periodId }
            ?: throw IllegalArgumentException("pilote: trimestre inconnu")
    }

    fun run(op: JVal.Obj): JVal {
        return when (op.str("op")) {
            "dateParse" -> ok("millis" to millis(dateParse(JVal.Str(op.reqStr("text")))))
            "datetimeParse" -> ok("millis" to millis(datetimeParse(JVal.Str(op.reqStr("text")))))
            "gradeParse" -> {
                val v = gradeParse(JVal.Str(op.reqStr("text")))
                ok("value" to (v?.let { JVal.Str(it) } ?: JVal.Null))
            }
            "htmlParse" -> ok("value" to JVal.Str(htmlParse(JVal.Str(op.reqStr("text")))))
            "place2time" -> {
                val (h, m) = place2time(op.fields["heures"], (op.num("place") ?: Double.NaN))
                ok("hour" to JVal.Num(h.toDouble()), "minute" to JVal.Num(m.toDouble()))
            }
            "numOf" -> ok("value" to JVal.Num(numOf(op.fields["value"])))
            "strOf" -> ok("value" to JVal.Str(strOf(op.fields["value"])))
            "boolOf" -> ok("value" to JVal.Bool(boolOf(op.fields["value"])))
            "clientQrcode" -> {
                val cid = nextId++
                val qr = QrCode(op.reqStr("loginHex"), op.reqStr("jetonHex"), op.reqStr("qrUrl"))
                val opts = QrLoginOptions(
                    accountPin = op.str("accountPin"),
                    clientIdentifier = op.str("clientIdentifier"),
                    deviceName = op.str("deviceName"),
                    skip2fa = op.bool("skip2fa") == true,
                )
                val client = Client.qrcodeLogin(qr, op.reqStr("pin"), op.reqStr("uuid"), opts)
                clients[cid] = client
                ok("cid" to JVal.Num(cid.toDouble()), "loggedIn" to JVal.Bool(client.logged_in))
            }
            // URL de QR réécrite (hôte « non serveur » : underscore, IDN).
            "rewriteQrUrl" -> ok("url" to JVal.Str(Client.rewriteQrUrl(op.reqStr("url"))))
            "clientLogin" -> {
                // Mot de passe (+ ENT injecté fixe côté pilote comme côté test).
                val cid = nextId++
                val withEnt = op.bool("ent") == true
                val opts = ClientOptions(
                    ent = if (withEnt) {
                        { _, _, _ -> CookieJar() }
                    } else {
                        null
                    },
                )
                clients[cid] = Client.login(op.reqStr("site"), op.reqStr("username"), op.reqStr("password"), opts)
                ok("cid" to JVal.Num(cid.toDouble()))
            }
            "clientState" -> {
                val c = client(op.num("cid"))
                val st = Render()
                st.putBool("loggedIn", c.logged_in)
                st.putNum("week", c.week.toDouble())
                st.putStr("loginMode", c.loginMode)
                st.putStr("username", c.username)
                st.putStr("password", c.password)
                st.putStr("uuid", c.uuid)
                st.putStr("clientIdentifier", c.clientIdentifier)
                st.put("periodIds", JVal.Arr(c.periods.map { JVal.Str(it.id) }))
                // Absent = clé omise (comme `undefined` côté TS).
                st.putStr("infoName", c.info.name)
                st.put("onglets", JVal.Arr(c.communication.authorizedOnglets.map { JVal.Num(it) }))
                st.build()
            }
            // `Client.post` (avec `Signature` + rejeu `refresh`), pas `Communication.post`.
            "clientPost" -> {
                val c = client(op.num("cid"))
                c.post(
                    op.reqStr("function"),
                    op.num("onglet"),
                    (op.fields["data"] as? JVal.Obj)?.fields,
                )
            }
            // Ping de session : `ifDue` respecte le seuil (110 s), `manual` le
            // force.
            "clientPing" -> {
                val c = client(op.num("cid"))
                val ka = c.keepAlive()
                if (op.str("mode") == "manual") ka.ping() else ka.pingIfDue()
                ok("ok" to JVal.Bool(true))
            }
            // Requêtes CONCURRENTES sur le MÊME client : le job de fond
            // et la lecture de l'interface tombent en erreur en même temps.
            // Le port doit sérialiser (un SEUL refresh, une seule
            // `Communication` vivante) et ne surfacer AUCUNE erreur : le
            // perdant attend le refresh et rejoue sur la session neuve.
            "clientConcurrentPost" -> {
                val c = client(op.num("cid"))
                val function = op.reqStr("function")
                val onglet = op.num("onglet")
                val data = (op.fields["data"] as? JVal.Obj)?.fields
                val n = (op.num("threads") ?: 2.0).toInt().coerceIn(1, 8)
                // La barrière : les N fils partent EN MÊME temps (sans elle,
                // le second fil ne testerait jamais la course).
                val barrier = java.util.concurrent.CyclicBarrier(n)
                val results = arrayOfNulls<String>(n)
                val payloads = arrayOfNulls<String>(n)
                val threads = (0 until n).map { i ->
                    Thread {
                        results[i] = try {
                            barrier.await(30, java.util.concurrent.TimeUnit.SECONDS)
                            val resp = c.post(function, onglet, data)
                            payloads[i] = Json.stringify(resp)
                            "ok"
                        } catch (e: Exception) {
                            e.javaClass.simpleName
                        }
                    }
                }
                threads.forEach { it.start() }
                threads.forEach { it.join(60_000) }
                ok(
                    "results" to JVal.Arr(results.map { JVal.Str(it ?: "timeout") }),
                    "payloads" to JVal.Arr(payloads.map { JVal.Str(it ?: "") }),
                )
            }
            "exportCreds" -> {
                val e = client(op.num("cid")).exportCredentials()
                ok(
                    "pronoteUrl" to JVal.Str(e.pronoteUrl),
                    "username" to JVal.Str(e.username),
                    "password" to JVal.Str(e.password),
                    "clientIdentifier" to (e.clientIdentifier?.let { JVal.Str(it) } ?: JVal.Null),
                    "uuid" to JVal.Str(e.uuid),
                )
            }
            "getWeek" -> {
                val c = client(op.num("cid"))
                ok("week" to JVal.Num(c.getWeek(parseDt(op.reqStr("date"))).toDouble()))
            }
            "periodGrades" -> {
                val c = client(op.num("cid"))
                JVal.Arr(periodOf(c, op.str("periodId")).grades().map { renderGrade(it) })
            }
            "periodAverages" -> {
                val c = client(op.num("cid"))
                JVal.Arr(periodOf(c, op.str("periodId")).averages().map { renderAverage(it) })
            }
            "periodOverall" -> {
                val c = client(op.num("cid"))
                periodOf(c, op.str("periodId")).overallAverage() ?: JVal.Null
            }
            "periodAbsences" -> {
                val c = client(op.num("cid"))
                JVal.Arr(periodOf(c, op.str("periodId")).absences().map { renderAbsence(it) })
            }
            "periodDelays" -> {
                val c = client(op.num("cid"))
                JVal.Arr(periodOf(c, op.str("periodId")).delays().map { renderDelay(it) })
            }
            "periodPunishments" -> {
                val c = client(op.num("cid"))
                JVal.Arr(periodOf(c, op.str("periodId")).punishments().map { renderPunishment(it) })
            }
            "lessons" -> {
                val c = client(op.num("cid"))
                JVal.Arr(c.lessons(parseDt(op.reqStr("from")), op.str("to")?.let { parseDt(it) }).map { renderLesson(it) })
            }
            "lessonContent" -> {
                val c = client(op.num("cid"))
                val lessons = c.lessons(parseDt(op.reqStr("from")), op.str("to")?.let { parseDt(it) })
                val lesson = lessons.firstOrNull { it.id == op.str("lessonId") }
                    ?: throw IllegalArgumentException("pilote: cours inconnu")
                lesson.content()?.let { renderLessonContent(it) } ?: JVal.Null
            }
            "homework" -> {
                val c = client(op.num("cid"))
                JVal.Arr(c.homework(parseDt(op.reqStr("from")), op.str("to")?.let { parseDt(it) }).map { renderHomework(it) })
            }
            "hwSetDone" -> {
                val c = client(op.num("cid"))
                val hws = c.homework(parseDt(op.reqStr("from")), op.str("to")?.let { parseDt(it) })
                val hw = hws.firstOrNull { it.id == op.str("hwId") }
                    ?: throw IllegalArgumentException("pilote: devoir inconnu")
                hw.setDone(op.bool("done") == true)
                ok("done" to JVal.Bool(hw.done))
            }
            "attachmentProbe" -> {
                // URL magique + octets du premier fichier du premier devoir.
                val c = client(op.num("cid"))
                val hws = c.homework(parseDt(op.reqStr("from")), op.str("to")?.let { parseDt(it) })
                val att = hws.firstOrNull()?.files()?.firstOrNull()
                    ?: throw IllegalStateException("aucune piece jointe")
                ok(
                    "url" to JVal.Str(att.url),
                    "dataHex" to JVal.Str(att.data().toHexLower()),
                    "name" to JVal.Str(att.name),
                )
            }
            "discussions" -> {
                val c = client(op.num("cid"))
                JVal.Arr(c.discussions(op.bool("onlyUnread") == true).map { renderDiscussion(it) })
            }
            "discussionFlow" -> {
                // messages + reply + markAs + delete + participants, en une passe.
                val c = client(op.num("cid"))
                val d = c.discussions(false).firstOrNull { it.id == op.str("discussionId") }
                    ?: throw IllegalArgumentException("pilote: discussion inconnue")
                val messages = d.messages()
                d.reply(op.str("text") ?: "vu")
                d.markAs(true)
                val parts = d.participants()
                d.delete()
                ok(
                    "messages" to JVal.Arr(messages.map { renderMessage(it) }),
                    "participants" to JVal.Arr(parts.map { it?.let { s -> JVal.Str(s) } ?: JVal.Null }),
                )
            }
            "messageRecipients" -> {
                val c = client(op.num("cid"))
                val d = c.discussions(false).firstOrNull { it.id == op.str("discussionId") }
                    ?: throw IllegalArgumentException("pilote: discussion inconnue")
                val m = d.messages().firstOrNull { it.id == op.str("messageId") }
                    ?: throw IllegalArgumentException("pilote: message inconnu")
                JVal.Arr(m.recipients().map { it?.let { s -> JVal.Str(s) } ?: JVal.Null })
            }
            "getRecipients" -> {
                val c = client(op.num("cid"))
                JVal.Arr(c.getRecipients().map { renderRecipient(it) })
            }
            "newDiscussion" -> {
                val c = client(op.num("cid"))
                val dests = c.getRecipients().filter { op.arr("to")?.contains(JVal.Str(it.id)) == true }
                c.newDiscussion(op.str("subject") ?: "", op.str("body") ?: "", dests)
                ok("sent" to JVal.Num(dests.size.toDouble()))
            }
            "news" -> {
                val c = client(op.num("cid"))
                val filter = InfoFilter(
                    onlyUnread = op.bool("onlyUnread") == true,
                    dateFrom = op.str("dateFrom")?.let { parseDt(it) },
                    dateTo = op.str("dateTo")?.let { parseDt(it) },
                )
                JVal.Arr(c.informationAndSurveys(filter).map { renderInformation(it) })
            }
            "newsContent" -> {
                val c = client(op.num("cid"))
                val n = c.informationAndSurveys().firstOrNull { it.id == op.str("newsId") }
                    ?: throw IllegalArgumentException("pilote: actu inconnue")
                ok(
                    "content" to JVal.Str(n.content()),
                    "attachments" to JVal.Arr(n.attachments().map { renderAttachment(it) }),
                )
            }
            "menus" -> {
                val c = client(op.num("cid"))
                JVal.Arr(c.menus(parseDt(op.reqStr("from")), op.str("to")?.let { parseDt(it) }).map { renderMenu(it) })
            }
            "clientInfo" -> {
                val c = client(op.num("cid"))
                val info = c.info
                ok(
                    "info" to renderClientInfo(info),
                    "cache" to (info.cache() ?: JVal.Null),
                )
            }
            else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
        }
    }
}

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

fun main() {
    val stdin: BufferedReader = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    val driver = ClientDriver()
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            val parsed = Json.parse(line) as JVal.Obj
            stdout.println(Json.stringify(driver.run(parsed)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
