#!/usr/bin/env bash
# Superviseur de compilation Kotlin — harnais de parité
# (cf. tests/unit/fixtures/kotlin-harness.ts).
#
#   kotlin-compile.sh <compilateur> [args...]
#
# POURQUOI CE SCRIPT EXISTE. Le `kotlinc` est un script bash qui lance `java`
# comme ENFANT : le compilateur et sa JVM tournent dans un GROUPE de processus
# à part, et c'est bien ce qu'on veut (tuer le groupe tue la JVM avec). Mais
# qui tue le groupe quand le worker de test meurt ? Personne — et
# `bun test --parallel` tue ses workers SANS signal (SIGKILL) au Ctrl-C : la
# JVM continuait donc de compiler à 100 % CPU en arrière-plan, après le retour
# du terminal. C'est le défaut exact qui motivé ce superviseur.
#
# COMMENT. Le superviseur tient l'extrémité d'ÉCRITURE d'un tube — celle du
# worker (le tube est son `stdin`). Quand le worker meurt, le tube se ferme et
# la lecture rend la fin de fichier : un signal INFALLIBLE, là où un test de
# vivacité par pid peut se tromper (réutilisation de pid par un autre
# processus). Le superviseur tue alors le groupe de processus.
#
# Le tube sert de TÉMOIN au superviseur ; le compilateur, lui, lit sur
# /dev/null (il ne lit rien).
set -u

compiler="$1"; shift

# Le témoin doit lire le tube du worker, PAS stdin : bash redirige stdin des
# jobs en arrière-plan vers /dev/null (job control désactivé) — le témoin
# verrait une fin de fichier IMMÉDIATE et tuerait la compilation au lieu de
# la surveiller. On duplique donc le tube sur le descripteur 3 AVANT de
# lancer le témoin en arrière-plan.
exec 3<&0

# Le témoin : fin de fichier sur le tube = le worker est mort.
(
  while IFS= read -r _ <&3; do :; done
  kill -KILL -- "-$$" 2>/dev/null
) &
witness=$!

exec 3<&-

"$compiler" "$@" < /dev/null &
child=$!

wait "$child"
code=$?
kill -KILL "$witness" 2>/dev/null
wait "$witness" 2>/dev/null
exit "$code"
