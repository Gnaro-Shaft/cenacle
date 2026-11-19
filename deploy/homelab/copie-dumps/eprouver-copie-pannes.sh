# Les épreuves nées de la panne du 31/10/2026 : pool thin plein, va-et-vient,
# écriture différée, dumps qui restaient en échec pour toujours. Chargé par
# `eprouver-copie.sh`, dont il emploie les outils.

# ------------------------------------------------------------------------------
echo "— on ne tire que ce qu'on gardera : plus de va-et-vient"
banc vaetvient
for j in 09_01 09_02 09_03 09_04 09_05 09_06 09_07; do dump "$SRC" "$(nom_du $j)"; done
lancer
verifier "trois dumps arrivent, pas sept"    "3"      "$(dumps_presents)"
verifier "aucun élagage : rien de surnuméraire" "0"   "$(grep -c 'élagué' "$CAS/sortie")"
verifier "le verdict est SAIN"               "SAIN"   "$(champ verdict)"
lancer
verifier "second passage : rien n'est revenu" "0"     "$(grep -c 'élagué' "$CAS/sortie")"
dump "$SRC" "$(nom_du 09_08)"
lancer
verifier "un jour de plus : un seul élagage" "1"      "$(grep -c 'élagué' "$CAS/sortie")"
lancer
verifier "le dump élagué ne revient pas"     "0"      "$(existe "$DST/$(nom_du 09_05)")"
verifier "et rien n'est élagué de nouveau"   "0"      "$(grep -c 'élagué' "$CAS/sortie")"

# ------------------------------------------------------------------------------
echo "— la source a perdu ses dumps récents : les anciens ne reviennent pas chaque nuit"
banc source_amputee
for j in 09_01 09_02 09_03 09_04 09_05; do dump "$SRC" "$(nom_du $j)"; done
lancer
rm -f "$SRC/$(nom_du 09_04)" "$SRC/$(nom_du 09_05)"
lancer
verifier "le plus ancien n'est pas tiré"     "0"      "$(existe "$DST/$(nom_du 09_01)")"
verifier "aucun élagage"                     "0"      "$(grep -c 'élagué' "$CAS/sortie")"
verifier "les trois récents sont intacts"    "3"      "$(dumps_presents)"

# ------------------------------------------------------------------------------
echo "— un dump en cours d'écriture, ou un fichier étranger, n'est pas tiré"
banc en_cours
dump "$SRC" "$(nom_du 09_05)"
: > "$SRC/vzdump-lxc-500-2026_10_23-03_00_04.tar.dat"
: > "$SRC/vzdump-lxc-500-2026_10_23-03_00_04.tmp"
mkdir "$SRC/vzdump-qemu-400-2026_10_23-03_00_04.tmp"
: > "$SRC/mon-script.sh"
lancer
verifier "le verdict est SAIN"               "SAIN"   "$(champ verdict)"
verifier "seul le dump est arrivé"           "1"      "$(dumps_presents)"
verifier "pas le .tar.dat"                   "0"      "$(existe "$DST/vzdump-lxc-500-2026_10_23-03_00_04.tar.dat")"
verifier "pas le répertoire .tmp"            "0"      "$(existe "$DST/vzdump-qemu-400-2026_10_23-03_00_04.tmp")"
verifier "pas le fichier étranger"           "0"      "$(existe "$DST/mon-script.sh")"

# ------------------------------------------------------------------------------
echo "— un dump sans journal ni note ne fait pas échouer rsync"
banc sans_annexes
dump "$SRC" "$(nom_du 09_05)"
rm -f "$SRC/$(nom_du 09_05).notes" "$SRC/vzdump-lxc-200-2026_09_05-02_05_39.log"
lancer
verifier "le verdict est SAIN"               "SAIN"   "$(champ verdict)"

# ------------------------------------------------------------------------------
echo "— l'invité 20 ne se confond pas avec l'invité 200"
banc voisins
for j in 09_01 09_02 09_03 09_04; do
    dump "$SRC" "$(nom_du $j)"
    dump "$SRC" "vzdump-lxc-20-2026_${j}-02_05_39.tar.zst"
done
lancer
verifier "trois par invité"                  "6"      "$(dumps_presents)"
verifier "l'invité 20 est au verdict"        "1"      "$(grep -c '^invite=20:3:' "$ETA/verdict")"

# ------------------------------------------------------------------------------
echo "— rsync écrit sur disque avant de donner son nom au fichier"
banc fsync
dump "$SRC" "$(nom_du 09_05)"
: > "$CAS/espion"
RSYNC_ESSAI="$BANC/rsync-espion" lancer
verifier "--fsync est demandé au transfert"  "1"      "$(grep -c -- '--fsync' "$CAS/espion")"

if command -v strace >/dev/null; then
    echo "— fsync échoue vraiment : la panne se voit, et aucun faux dump n'apparaît"
    banc fsync_ko
    dump "$SRC" "$(nom_du 09_05)"
    RSYNC_ESSAI="$BANC/rsync-fsync-ko" lancer
    verifier "le verdict est MALADE"         "MALADE" "$(champ verdict)"
    verifier "le motif nomme rsync"          "1"      "$(grep -c '^motif=rsync' "$ETA/verdict")"
    verifier "le dump n'a pas son nom définitif" "0"  "$(existe "$DST/$(nom_du 09_05)")"
    verifier "l'unité sort en échec"         "1"      "$([ "$CODE" -ne 0 ] && echo 1 || echo 0)"
    lancer
    verifier "le passage suivant le rattrape" "SAIN"  "$(champ verdict)"
    verifier "et le dump est arrivé"         "1"      "$(existe "$DST/$(nom_du 09_05)")"
else
    ECHOUEES=$((ECHOUEES + 1))
    echo "  ✗ strace absent : la panne de fsync n'a PAS été éprouvée"
fi

# ------------------------------------------------------------------------------
echo "— la copie est abîmée, la source est saine : on la répare, et on sort de MALADE"
banc retente
dump "$SRC" "$(nom_du 09_05)"
cp -p "$SRC/$(nom_du 09_05)" "$DST/"
abimer "$DST/$(nom_du 09_05)"
lancer
verifier "le premier passage la voit abîmée" "MALADE" "$(champ verdict)"
: > "$CAS/espion"
RSYNC_ESSAI="$BANC/rsync-espion" lancer
verifier "le suivant compare les contenus"   "1"      "$(grep -c -- '--checksum' "$CAS/espion")"
verifier "le verdict redevient SAIN"         "SAIN"   "$(champ verdict)"
verifier "aucun corrompu"                    "0"      "$(champ corrompus)"
verifier "la copie est identique à la source" "1"     "$(cmp -s "$SRC/$(nom_du 09_05)" "$DST/$(nom_du 09_05)" && echo 1 || echo 0)"
verifier "son marqueur est revenu à ok"      "ok"     "$(awk -F= '$1=="etat"{print $2}' "$ETA/controles/$(nom_du 09_05).controle")"
verifier "et la panne n'est plus datée"      "-"      "$(champ depuis)"
: > "$CAS/espion"
RSYNC_ESSAI="$BANC/rsync-espion" lancer
verifier "une fois réparée, plus de comparaison" "0"  "$(grep -c -- '--checksum' "$CAS/espion")"

# ------------------------------------------------------------------------------
echo "— un vieux dump réparé ne chasse aucune des trois copies récentes"
banc retente_vieux
for j in 09_01 09_02 09_03 09_04; do dump "$SRC" "$(nom_du $j)"; done
lancer
cp -p "$SRC/$(nom_du 09_01)" "$DST/"
abimer "$DST/$(nom_du 09_01)"
lancer
verifier "il est d'abord vu abîmé"           "MALADE" "$(champ verdict)"
lancer
verifier "le verdict redevient SAIN"         "SAIN"   "$(champ verdict)"
verifier "réparé puis élagué : il part"      "0"      "$(existe "$DST/$(nom_du 09_01)")"
verifier "les trois récents sont là"         "3"      "$(dumps_presents)"

# ------------------------------------------------------------------------------
echo "— la source est abîmée elle aussi : pas de retéléchargement chaque nuit"
banc source_abimee
dump_tronque "$SRC" "$(nom_du 09_05)"
lancer
INODE=$(stat -c '%i' "$DST/$(nom_du 09_05)")
lancer
verifier "toujours MALADE"                   "MALADE" "$(champ verdict)"
verifier "le fichier n'a pas été réécrit"    "$INODE" "$(stat -c '%i' "$DST/$(nom_du 09_05)")"
verifier "il reste en place"                 "1"      "$(dumps_presents)"

# ------------------------------------------------------------------------------
echo "— le dump abîmé n'est plus à la source : il reste, et le verdict le nomme"
banc plus_a_la_source
dump "$SRC" "$(nom_du 09_05)"
dump_tronque "$DST" "$(nom_du 08_01)"
lancer
verifier "dès le premier passage, la cause"  "1"      "$(grep -c 'flux zstd illisible (.*) — la copie' "$ETA/verdict")"
lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "il reste en place"                 "1"      "$(existe "$DST/$(nom_du 08_01)")"
verifier "rsync n'est pas mis en cause"      "0"      "$(grep -c '^motif=rsync' "$ETA/verdict")"
verifier "le motif dit l'échec et sa cause"  "1"      "$(grep -c 'contrôlé en échec (.*), laissé en place' "$ETA/verdict")"
verifier "la cause ne révèle aucun chemin"   "0"      "$(grep '^motif=' "$ETA/verdict" | grep -c "$DST")"

echo "— un marqueur d'avant cette version, sans cause, reste lisible"
sed -i '/^raison=/d' "$ETA/controles/$(nom_du 08_01).controle"
lancer
verifier "le motif reste correct"            "1"      "$(grep -c "$(nom_du 08_01) : contrôlé en échec, laissé en place" "$ETA/verdict")"

# ------------------------------------------------------------------------------
echo "— un dump absent de la source n'empêche pas de réparer les autres"
# La situation réelle du 07/11/2026 : six dumps perdus, trois encore à la source.
banc reparation_mixte
dump "$SRC" "$(nom_du 09_05)"
cp -p "$SRC/$(nom_du 09_05)" "$DST/"
abimer "$DST/$(nom_du 09_05)"
dump_tronque "$DST" "$(nom_du 08_01)"
lancer
lancer
verifier "celui de la source est réparé"     "ok"     "$(awk -F= '$1=="etat"{print $2}' "$ETA/controles/$(nom_du 09_05).controle")"
verifier "identique à la source"             "1"      "$(cmp -s "$SRC/$(nom_du 09_05)" "$DST/$(nom_du 09_05)" && echo 1 || echo 0)"
verifier "l'autre reste en échec"            "echec"  "$(awk -F= '$1=="etat"{print $2}' "$ETA/controles/$(nom_du 08_01).controle")"
verifier "rsync n'est pas mis en cause"      "0"      "$(grep -c '^motif=rsync' "$ETA/verdict")"
verifier "le verdict reste MALADE"           "MALADE" "$(champ verdict)"
verifier "un seul motif, pour celui-là"      "1"      "$(grep -c '^motif=' "$ETA/verdict")"

# ------------------------------------------------------------------------------
echo "— la réparation échoue : le dump reste en échec, rien n'est perdu"
banc retente_ko
dump "$SRC" "$(nom_du 09_05)"
cp -p "$SRC/$(nom_du 09_05)" "$DST/"
abimer "$DST/$(nom_du 09_05)"
lancer
ESPION_ECHEC="--checksum" RSYNC_ESSAI="$BANC/rsync-espion" lancer
verifier "le verdict reste MALADE"           "MALADE" "$(champ verdict)"
verifier "le motif nomme rsync"              "1"      "$(grep -c '^motif=rsync' "$ETA/verdict")"
verifier "le marqueur reste en échec"        "echec"  "$(awk -F= '$1=="etat"{print $2}' "$ETA/controles/$(nom_du 09_05).controle")"
verifier "la copie reste en place"           "1"      "$(existe "$DST/$(nom_du 09_05)")"

# ------------------------------------------------------------------------------
echo "— la liste de la source échoue : on ne décide rien sur une liste vide"
banc liste_ko
dump "$SRC" "$(nom_du 09_05)"
lancer
ESPION_ECHEC="--list-only" RSYNC_ESSAI="$BANC/rsync-espion" lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "le motif nomme rsync"              "1"      "$(grep -c '^motif=rsync' "$ETA/verdict")"
verifier "la copie est intacte"              "1"      "$(dumps_presents)"
verifier "rien ne traîne dans l'état"        "0"      "$(ls -A "$ETA" | grep -c '^\.tirage')"

# ------------------------------------------------------------------------------
echo "— le pool thin : ce que df ne voit pas"
banc pool
dump "$SRC" "$(nom_du 09_05)"
lancer
verifier "pool sous le seuil : SAIN"         "SAIN"   "$(champ verdict)"
verifier "le verdict dit l'occupation"       "50"     "$(champ pool_pct)"
dump "$SRC" "$(nom_du 09_06)"
FAUX_PCT="90.01 3.00" lancer
verifier "90,01 % : copie refusée"           "1"      "$(grep -c 'pool LVM plein à 91 %.*copie refusée' "$ETA/verdict")"
verifier "le dump neuf n'est pas arrivé"     "0"      "$(existe "$DST/$(nom_du 09_06)")"
verifier "la copie d'avant est intacte"      "1"      "$(existe "$DST/$(nom_du 09_05)")"
FAUX_PCT="10.00 95.00" lancer
verifier "métadonnées pleines : refus aussi" "1"      "$(grep -c 'pool LVM plein à 95 %' "$ETA/verdict")"
FAUX_LVS_ECHEC=1 lancer
verifier "lvs en échec : refus"              "1"      "$(grep -c 'pool LVM .* illisible — copie refusée' "$ETA/verdict")"
verifier "le verdict dit qu'il ne sait pas"  "?"      "$(champ pool_pct)"
FAUX_PCT="pas un nombre" lancer
verifier "réponse absurde : refus"           "1"      "$(grep -c 'illisible — copie refusée' "$ETA/verdict")"
FAUX_VG_POOL="" lancer
verifier "lvs muet : refus"                  "1"      "$(grep -c 'illisible — copie refusée' "$ETA/verdict")"
verifier "le dump neuf n'est toujours pas là" "0"     "$(existe "$DST/$(nom_du 09_06)")"
FAUX_PCT="90.00 3.00" lancer
verifier "90,00 % pile : la copie passe"     "1"      "$(existe "$DST/$(nom_du 09_06)")"
verifier "et le verdict redevient SAIN"      "SAIN"   "$(champ verdict)"

echo "— pas de pool thin : le garde-fou ne bloque pas la copie retour"
banc sans_pool
dump "$SRC" "$(nom_du 09_05)"
FAUX_VG_POOL="pve" lancer
verifier "volume LVM ordinaire : SAIN"       "SAIN"   "$(champ verdict)"
verifier "le verdict dit « - »"              "-"      "$(champ pool_pct)"
PERIPH_ESSAI="/dev/sda1" FAUX_LVS_ECHEC=1 lancer
verifier "hors LVM, lvs n'est pas consulté"  "SAIN"   "$(champ verdict)"

echo "— la réparation n'a pas lieu quand le pool la refuse"
banc retente_pool
dump "$SRC" "$(nom_du 09_05)"
cp -p "$SRC/$(nom_du 09_05)" "$DST/"
abimer "$DST/$(nom_du 09_05)"
lancer
: > "$CAS/espion"
FAUX_PCT="95.00 3.00" RSYNC_ESSAI="$BANC/rsync-espion" lancer
verifier "rsync n'est même pas appelé"       "0"      "$(wc -l < "$CAS/espion" | tr -d ' ')"
verifier "le marqueur reste en échec"        "echec"  "$(awk -F= '$1=="etat"{print $2}' "$ETA/controles/$(nom_du 09_05).controle")"

# ------------------------------------------------------------------------------
echo "— le module de tirage manque : l'unité échoue au lieu de se taire"
banc sans_module
dump "$SRC" "$(nom_du 09_05)"
mkdir "$CAS/seul"
cp "$SCRIPT" "$CAS/seul/copier-les-dumps"
COPIE_SOURCE="$SRC/" COPIE_DEST="$DST" COPIE_ETAT="$ETA" "$CAS/seul/copier-les-dumps" > "$CAS/sortie" 2>&1
CODE=$?
verifier "l'unité sort en échec"             "1"      "$([ "$CODE" -ne 0 ] && echo 1 || echo 0)"
verifier "elle dit ce qui manque"            "1"      "$(grep -c 'impossible de charger' "$CAS/sortie")"
verifier "elle s'arrête sans rien juger"     "0"      "$(existe "$ETA/verdict")"
verifier "ni rien copier"                    "0"      "$(dumps_presents)"
