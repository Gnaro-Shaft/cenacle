#!/bin/bash
# Épreuves adverses de la copie des sauvegardes.
#
# Elles ne cherchent pas à confirmer que ça marche : elles cherchent à mettre
# le dispositif en défaut. Source injoignable, dump tronqué, disque saturé,
# source tarie, élagage qui mangerait les bonnes copies pour garder une
# mauvaise.
#
# **Le script à éprouver se désigne.** Un harnais qui n'éprouve que la copie
# installée dans `/usr/local/bin` ne sert que la moitié du temps : on ne peut
# alors rien vérifier **avant** de déployer. C'est la leçon du harnais du
# veilleur, corrigée le 07/09/2026.
#
#   ./eprouver-copie.sh                      # éprouve /usr/local/bin/copier-les-dumps
#   ./eprouver-copie.sh ./copier-les-dumps   # éprouve la copie du dépôt
set -uo pipefail

SCRIPT="${1:-/usr/local/bin/copier-les-dumps}"
[ -x "$SCRIPT" ] || { echo "introuvable ou non exécutable : $SCRIPT"; exit 2; }
SCRIPT=$(cd "$(dirname "$SCRIPT")" && pwd)/$(basename "$SCRIPT")

command -v zstd >/dev/null || { echo "zstd absent : les épreuves ne peuvent rien contrôler"; exit 2; }

REUSSIES=0; ECHOUEES=0
BANC=$(mktemp -d)
trap 'rm -rf "$BANC"' EXIT

verifier() {
    local quoi="$1" attendu="$2" obtenu="$3"
    if [ "$attendu" = "$obtenu" ]; then
        REUSSIES=$((REUSSIES + 1)); printf '  ✓ %s\n' "$quoi"
    else
        ECHOUEES=$((ECHOUEES + 1))
        printf '  ✗ %s\n      attendu : %s\n      obtenu  : %s\n' "$quoi" "$attendu" "$obtenu"
    fi
}

# Un dump valide : un vrai flux zstd, que `zstd -t` déroulera vraiment.
dump() {
    local dir="$1" nom="$2"
    mkdir -p "$dir"
    # `-f` : sans lui, zstd refuse d'ecraser et l'epreuve du recontrole ne
    # changeait que la date du fichier, jamais son contenu. Le troisieme
    # argument fait varier les octets pour de bon.
    printf 'contenu factice de %s %s' "$nom" "${3:-}" | zstd -qf -o "$dir/$nom"
    printf 'journal factice\n' > "$dir/${nom%%.*}.log"
    printf 'notes\n' > "$dir/$nom.notes"
}

# Un dump tronqué : les premiers octets d'un flux valide. Il ressemble en tout
# point à un dump — nom, extension, taille non nulle — et ne se déroule pas.
dump_tronque() {
    local dir="$1" nom="$2"
    dump "$dir" "$nom"
    local taille; taille=$(stat -c '%s' "$dir/$nom")
    truncate -s $(( taille / 2 )) "$dir/$nom"
}

# Un banc d'essai : source, destination et état, tous neufs.
banc() {
    CAS=$(mktemp -d "$BANC/$1.XXXX")
    SRC="$CAS/source"; DST="$CAS/dest"; ETA="$CAS/etat"
    mkdir -p "$SRC" "$DST" "$ETA"
}

# Un faux `lvs` : les épreuves ne lisent jamais le vrai pool de la machine.
cat > "$BANC/faux-lvs" <<'FAUX'
#!/bin/bash
[ -z "${FAUX_LVS_ECHEC:-}" ] || exit 5
case "$*" in
    *vg_name*) echo "  ${FAUX_VG_POOL-pve data}" ;;
    *) echo "  ${FAUX_PCT:-50.00 3.00}" ;;
esac
FAUX
# Un vrai rsync, dont on note les arguments et qu'on peut faire échouer.
cat > "$BANC/rsync-espion" <<'ESPION'
#!/bin/bash
echo "$*" >> "$ESPION"
case "$*" in *"${ESPION_ECHEC:-@aucun@}"*) exit 12 ;; esac
exec rsync "$@"
ESPION
# Un vrai rsync dont chaque fsync échoue : la panne d'écriture différée elle-même.
cat > "$BANC/rsync-fsync-ko" <<'KO'
#!/bin/bash
exec strace -f -qq -o /dev/null -e trace=fsync -e inject=fsync:error=EIO rsync "$@"
KO
chmod +x "$BANC/faux-lvs" "$BANC/rsync-espion" "$BANC/rsync-fsync-ko"

lancer() {
    COPIE_SOURCE="$SRC/" COPIE_DEST="$DST" COPIE_ETAT="$ETA" \
    COPIE_GARDEES="${GARDEES:-3}" COPIE_MARGE="${MARGE:-0}" \
    COPIE_PEREMPTION="${PEREMPTION:-864000}" \
    COPIE_LVS="$BANC/faux-lvs" COPIE_PERIPH="${PERIPH_ESSAI:-/dev/mapper/faux}" \
    COPIE_RSYNC="${RSYNC_ESSAI:-rsync}" ESPION="$CAS/espion" \
        "$SCRIPT" > "$CAS/sortie" 2>&1
    CODE=$?
}

# Abîmer une copie sans changer ni sa taille ni sa date : ce que laisse un pool
# plein, et que ni le test rapide de rsync ni l'empreinte ne peuvent voir.
abimer() {
    local quand; quand=$(stat -c '%y' "$1")
    dd if=/dev/zero of="$1" bs=1 count=8 conv=notrunc status=none
    touch -d "$quand" "$1"
}
existe() { [ -e "$1" ] && echo 1 || echo 0; }
nom_du() { echo "vzdump-lxc-200-2026_${1}-02_05_39.tar.zst"; }

champ() { awk -v k="$1" -F= '$1==k{print $2; exit}' "$ETA/verdict" 2>/dev/null; }
# `grep -c` affiche deja « 0 » quand il ne trouve rien — et sort en 1. Un
# `|| echo 0` y ajoutait un second zero, et la comparaison echouait sur un cas
# qui allait pourtant bien. Vu en l'eprouvant, pas en le relisant.
# Toute archive, quelle que soit son extension — surtout pas les seules
# « .tar.zst ». Une machine virtuelle rend un « .vma.zst », et compter les unes
# sans les autres est precisement le defaut du 18/09/2026.
dumps_presents() { ls "$DST" 2>/dev/null | grep -E '^vzdump-' | grep -vE '\.(log|notes)$' | wc -l | tr -d " "; }

# ------------------------------------------------------------------------------
echo "— la source ne répond pas"
banc injoignable
SRC="$CAS/n-existe-pas"
lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "l'unité sort en échec"             "1"      "$([ "$CODE" -ne 0 ] && echo 1 || echo 0)"
verifier "le verdict est clos par fin=1"     "1"      "$(champ fin)"
verifier "le motif nomme rsync"              "1"      "$(grep -c '^motif=rsync' "$ETA/verdict")"

# ------------------------------------------------------------------------------
echo "— la source est vide : aucune sauvegarde n'est un cri, pas un silence"
banc vide
lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "le motif dit qu'il n'y a rien"     "1"      "$(grep -c 'aucune sauvegarde' "$ETA/verdict")"

# ------------------------------------------------------------------------------
echo "— copie nominale"
banc nominal
dump "$SRC" "vzdump-lxc-200-2026_09_12-02_05_39.tar.zst"
lancer
verifier "le verdict est SAIN"               "SAIN"   "$(champ verdict)"
verifier "l'unité sort en succès"            "0"      "$CODE"
verifier "le dump est arrivé"                "1"      "$(dumps_presents)"
verifier "ses annexes aussi"                 "1"      "$([ -f "$DST/vzdump-lxc-200-2026_09_12-02_05_39.log" ] && echo 1 || echo 0)"
verifier "il a été contrôlé"                 "1"      "$(champ controles)"
verifier "aucun corrompu"                    "0"      "$(champ corrompus)"

# ------------------------------------------------------------------------------
echo "— le même passage, deux fois : on ne recontrôle pas ce qui n'a pas bougé"
lancer
verifier "aucun nouveau contrôle"            "0"      "$(champ controles)"
verifier "toujours SAIN"                     "SAIN"   "$(champ verdict)"

# ------------------------------------------------------------------------------
echo "— le dump change à la source : on le recontrôle"
dump "$SRC" "vzdump-lxc-200-2026_09_12-02_05_39.tar.zst" "autre contenu"
touch -d '2026-09-18 04:00' "$SRC/vzdump-lxc-200-2026_09_12-02_05_39.tar.zst"
lancer
verifier "il est recontrôlé"                 "1"      "$(champ controles)"

# ------------------------------------------------------------------------------
echo "— un dump tronqué ne passe pas pour une sauvegarde"
banc tronque
dump_tronque "$SRC" "vzdump-lxc-200-2026_09_12-02_05_39.tar.zst"
lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "il est compté corrompu"            "1"      "$(champ corrompus)"
verifier "le motif nomme le flux zstd"       "1"      "$(grep -c 'zstd illisible' "$ETA/verdict")"
verifier "le fichier reste en place"         "1"      "$(dumps_presents)"
verifier "l'invité n'a aucune copie saine"   "1"      "$(grep -c 'aucune copie contrôlée saine' "$ETA/verdict")"

# ------------------------------------------------------------------------------
echo "— l'élagage garde les trois plus récents, et pas d'autres"
banc elagage
for j in 08_15 08_22 08_29 09_05 09_12; do
    dump "$SRC" "vzdump-lxc-200-2026_${j}-02_05_39.tar.zst"
done
lancer
verifier "trois dumps gardés"                "3"      "$(dumps_presents)"
verifier "le plus récent est là"             "1"      "$([ -f "$DST/vzdump-lxc-200-2026_09_12-02_05_39.tar.zst" ] && echo 1 || echo 0)"
verifier "le plus ancien est parti"          "0"      "$([ -f "$DST/vzdump-lxc-200-2026_08_15-02_05_39.tar.zst" ] && echo 1 || echo 0)"
verifier "son journal est parti avec lui"    "0"      "$([ -f "$DST/vzdump-lxc-200-2026_08_15-02_05_39.log" ] && echo 1 || echo 0)"
verifier "et son marqueur de contrôle"       "0"      "$([ -f "$ETA/controles/vzdump-lxc-200-2026_08_15-02_05_39.tar.zst.controle" ] && echo 1 || echo 0)"
verifier "le verdict reste SAIN"             "SAIN"   "$(champ verdict)"

# ------------------------------------------------------------------------------
echo "— un dump neuf et corrompu ne chasse pas trois dumps sains"
# En deux temps, comme en vrai : les trois sains sont déjà là quand le corrompu
# arrive. La source en garde plus que la copie, et on ne tire que les récents.
banc elagage_corrompu
for j in 08_22 08_29 09_05; do
    dump "$SRC" "vzdump-lxc-200-2026_${j}-02_05_39.tar.zst"
done
lancer
dump_tronque "$SRC" "vzdump-lxc-200-2026_09_12-02_05_39.tar.zst"
lancer
verifier "les trois sains sont là"           "1"      "$([ -f "$DST/vzdump-lxc-200-2026_08_22-02_05_39.tar.zst" ] && \
                                                          [ -f "$DST/vzdump-lxc-200-2026_08_29-02_05_39.tar.zst" ] && \
                                                          [ -f "$DST/vzdump-lxc-200-2026_09_05-02_05_39.tar.zst" ] && echo 1 || echo 0)"
verifier "le corrompu reste, signalé"        "1"      "$([ -f "$DST/vzdump-lxc-200-2026_09_12-02_05_39.tar.zst" ] && echo 1 || echo 0)"
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"

# ------------------------------------------------------------------------------
echo "— chaque invité compte pour lui-même"
banc invites
for j in 08_22 08_29 09_05 09_12; do
    dump "$SRC" "vzdump-lxc-200-2026_${j}-02_05_39.tar.zst"
    dump "$SRC" "vzdump-qemu-300-2026_${j}-02_05_39.vma.zst"
done
lancer
verifier "six dumps : trois par invité"      "6"      "$(dumps_presents)"
verifier "les deux invités sont au verdict"  "2"      "$(grep -c '^invite=' "$ETA/verdict")"
verifier "un invité qemu est reconnu"        "1"      "$(grep -c '^invite=300:' "$ETA/verdict")"

# ------------------------------------------------------------------------------
echo "— la place manque : on refuse de copier, on ne détruit rien"
banc place
for j in 08_29 09_05 09_12; do dump "$SRC" "vzdump-lxc-200-2026_${j}-02_05_39.tar.zst"; done
lancer
AVANT=$(dumps_presents)
dump "$SRC" "vzdump-lxc-200-2026_09_19-02_05_39.tar.zst"
MARGE=99999999 lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "le motif parle de la marge"        "1"      "$(grep -c 'copie refusée' "$ETA/verdict")"
verifier "les copies d'avant sont intactes"  "$AVANT" "$(dumps_presents)"
verifier "le dump neuf n'est pas arrivé"     "0"      "$([ -f "$DST/vzdump-lxc-200-2026_09_19-02_05_39.tar.zst" ] && echo 1 || echo 0)"

# ------------------------------------------------------------------------------
echo "— la source s'est tarie : la copie va bien, il n'y a plus rien à copier"
banc tarie
dump "$SRC" "vzdump-lxc-200-2026_07_04-02_05_39.tar.zst"
touch -d '2026-07-04 02:05' "$SRC/vzdump-lxc-200-2026_07_04-02_05_39.tar.zst"
lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "le motif dit que la source ne produit plus" "1" "$(grep -c "n'en produit plus" "$ETA/verdict")"
verifier "la copie est pourtant bien là"     "1"      "$(dumps_presents)"

# ------------------------------------------------------------------------------
echo "— la panne est datée, et sa date ne bouge pas au passage suivant"
banc datation
SRC="$CAS/n-existe-pas"
lancer
D1=$(champ depuis)
sleep 1
lancer
verifier "la date de début est conservée"    "$D1"    "$(champ depuis)"
verifier "elle n'est pas « - »"              "1"      "$([ "$D1" != "-" ] && [ -n "$D1" ] && echo 1 || echo 0)"

# ------------------------------------------------------------------------------
echo "— le verdict n'est jamais lu à moitié écrit"
banc atomique
dump "$SRC" "vzdump-lxc-200-2026_09_12-02_05_39.tar.zst"
lancer
verifier "aucun fichier .partiel ne subsiste" "0"     "$(ls "$ETA" | grep -c 'partiel')"

# ------------------------------------------------------------------------------
echo "— une machine virtuelle rend un .vma.zst, et il compte comme les autres"
#
# Le defaut du 18/09/2026, jour ou le premier dump de VM est arrive. Le script
# ne reconnaissait que « .tar.zst » : l archive n etait ni controlee, ni
# comptee, ni elaguee — et le verdict disait SAIN, parce que le garde-fou
# « aucune sauvegarde » se fonde sur les noms, qui eux correspondaient.
#
# Mes propres fixtures nommaient « vzdump-qemu-300-….tar.zst », ce qui n existe
# pas. Une epreuve irrealiste ne prouve rien : c est elle qui m a cache le defaut.
banc vma
for j in 08_22 08_29 09_05 09_12; do
    dump "$SRC" "vzdump-qemu-301-2026_${j}-12_26_52.vma.zst"
done
lancer
verifier "le verdict est SAIN"               "SAIN"   "$(champ verdict)"
verifier "trois archives gardees"            "3"      "$(dumps_presents)"
verifier "les trois arrivees sont controlees" "3"     "$(champ controles)"
verifier "l invite figure au verdict"        "1"      "$(grep -c '^invite=301:3:' "$ETA/verdict")"
verifier "la plus ancienne n est pas tiree"  "0"      "$([ -f "$DST/vzdump-qemu-301-2026_08_22-12_26_52.vma.zst" ] && echo 1 || echo 0)"
verifier "son journal non plus"              "0"      "$([ -f "$DST/vzdump-qemu-301-2026_08_22-12_26_52.log" ] && echo 1 || echo 0)"
dump "$SRC" "vzdump-qemu-301-2026_09_19-12_26_52.vma.zst"
lancer
# Le controle precede l elaguage : on ne jette rien sur la foi d une archive
# qu on n a pas lue.
verifier "la nouvelle est controlee"         "1"      "$(champ controles)"
verifier "la plus ancienne gardee est elaguee" "0"    "$([ -f "$DST/vzdump-qemu-301-2026_08_29-12_26_52.vma.zst" ] && echo 1 || echo 0)"
verifier "son journal est parti avec elle"   "0"      "$([ -f "$DST/vzdump-qemu-301-2026_08_29-12_26_52.log" ] && echo 1 || echo 0)"

# ------------------------------------------------------------------------------
echo "— conteneurs et machines virtuelles cohabitent"
banc melange
for j in 08_29 09_05 09_12; do
    dump "$SRC" "vzdump-lxc-200-2026_${j}-02_05_39.tar.zst"
    dump "$SRC" "vzdump-qemu-302-2026_${j}-02_30_00.vma.zst"
done
lancer
verifier "six archives, deux invites"        "6"      "$(dumps_presents)"
verifier "les deux sont au verdict"          "2"      "$(grep -c '^invite=' "$ETA/verdict")"
verifier "les six sont controlees"           "6"      "$(champ controles)"

# ------------------------------------------------------------------------------
echo "— un journal sans son archive n est pas un silence"
#
# L autre moitie du defaut : l invite disparaissait du verdict sans qu un seul
# motif ne le dise.
banc sans_archive
mkdir -p "$SRC"
printf 'la sauvegarde a echoue\n' > "$SRC/vzdump-qemu-301-2026_09_18-12_26_52.log"
lancer
verifier "le verdict est MALADE"             "MALADE" "$(champ verdict)"
verifier "le motif nomme l invite"           "1"      "$(grep -c 'invité 301 : un journal, mais aucune archive' "$ETA/verdict")"

# Les pannes du 31/10/2026, dans leur fichier pour que celui-ci reste lisible.
# shellcheck source=eprouver-copie-pannes.sh
. "$(dirname "$(readlink -f "$0")")/eprouver-copie-pannes.sh"

echo
printf '%d réussies, %d échouées\n' "$REUSSIES" "$ECHOUEES"
[ "$ECHOUEES" -eq 0 ]
