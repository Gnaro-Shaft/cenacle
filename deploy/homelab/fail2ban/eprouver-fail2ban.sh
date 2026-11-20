#!/bin/bash
# Eprouve que fail2ban BANNIT, et pas seulement qu'il tourne.
#
#   deploy/homelab/fail2ban/eprouver-fail2ban.sh <compte@vps> <adresse ignoree>
#
# <adresse ignoree> : une adresse de /etc/fail2ban/jail.d/ignorer.local sur ce
# VPS, celle d'ou passe la ronde ; jamais ecrite dans le depot (ADR-0045).
#
# La difference est tout le sujet : un service « active » dont la jail lit un
# fichier inexistant a exactement l'air d'un service qui fait son travail.
set -uo pipefail

CIBLE="${1:?usage: $0 <compte@vps> <adresse ignoree>}"
ADRESSE="${2:?usage: $0 <compte@vps> <adresse ignoree>}"
# Elle part dans une commande distante : des chiffres, des points, des deux-points, une barre.
[[ "$ADRESSE" =~ ^[0-9A-Fa-f:./]+$ ]] || { echo "adresse hors de forme : $ADRESSE" >&2; exit 2; }
# fail2ban l'ecrit sans son « /32 ».
ADRESSE="${ADRESSE%/32}"
SSH="${F2B_SSH:-/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=15}"
REUSSIES=0; ECHOUEES=0

verifier() {
    if [ "$2" = "$3" ]; then
        REUSSIES=$((REUSSIES+1)); echo "  ok    $1"
    else
        ECHOUEES=$((ECHOUEES+1)); echo "  ECHEC $1 -- attendu \"$2\", obtenu \"$3\""
    fi
}

echo "-- $CIBLE --"

ACTIF=$($SSH "$CIBLE" 'systemctl is-active fail2ban' 2>&1)
verifier "le service tourne" "active" "$ACTIF"

# ATTENTION AUX MOTIFS. « \t » n'est pas une tabulation pour « grep -oE » :
# c'est un antislash suivi d'un « t ». La sortie de fail2ban-client est
# tabulee, et ce harnais a d'abord rendu « la jail ne voit AUCUN echec » sur
# deux machines qui bannissaient parfaitement. Un harnais qui se trompe fait
# exactement le bruit du defaut qu'il cherche.

# Le controle qui compte : une jail qui lit le journal, pas un fichier absent.
BACKEND=$($SSH "$CIBLE" 'sudo -n fail2ban-client get sshd logencoding >/dev/null 2>&1 && grep -h "^backend" /etc/fail2ban/jail.local' 2>&1 | tr -d " ")
verifier "la jail lit le journal" "backend=systemd" "$BACKEND"

# Ce que la jail a compte, face a ce que le journal porte, depuis le meme
# instant : le demarrage de fail2ban, qui remet son compteur a zero. Zero et
# zero, il n'y a rien a juger — le 20/11/2026, quatre minutes apres une pose,
# l'ancien controle avait crie « AUCUN echec » sur une jail qui marchait.
# Zero face a un journal qui en porte : elle lit au mauvais endroit, le piege.
#
# Le journal est juge par fail2ban-regex en mode « normal », quel que soit celui
# de la jail : chaque echec du mode normal en est un aussi en « aggressive »
# (eprouve le 20/11 sur fail2ban 1.1 : sa seule regle propre ne compte jamais
# d'echec). Juge depuis un fichier : sur Debian 12, fail2ban-regex plante sur
# « systemd-journal[journalmatch=...] ». Les lignes des adresses ignorees sont
# retirees : la jail ne les compte pas. Ni « sshd » seul, ni la liste de la
# jail : un journal qu'elle ne lit pas doit rester visible ici.
#
# Le journal s'arrete dix secondes AVANT que le compteur soit lu : un echec
# arrive pendant l'epreuve, que la jail n'aurait pas encore traite, ne passe pas
# pour un echec qu'elle ignore. Ce que ce controle suppose :
#   - le compteur ne repart a zero qu'au demarrage du service : apres un
#     « fail2ban-client reload », redemarrer fail2ban avant l'epreuve ;
#   - seules les adresses simples d'ignoreip (et la boucle locale) sont
#     retirees du journal, pas un reseau « a.b.c.d/n » : ignorer.local n'en
#     porte pas ;
#   - le compte a « sudo » sans mot de passe pour bash, comme pour la pose.
# Une fonction, et non un heredoc dans « $(...) » : le bash du Mac (3.2) lit
# mal ce dernier. Rien ici ne lit l'entree standard, qui porte ce script.
compter() {
$SSH "$CIBLE" 'sudo -n bash -s' <<'DISTANT'
set -uo pipefail
DEPUIS=$(systemctl show fail2ban -p ActiveEnterTimestamp --value)
DEBUT=""; [ -n "$DEPUIS" ] && DEBUT=$(date -d "$DEPUIS" +%s 2>/dev/null)
[ -n "$DEBUT" ] || { echo "demarrage=illisible"; exit 0; }
JUSQUE=$(( $(date +%s) - 10 ))
T=$(mktemp); F=$(mktemp); trap 'rm -f "$T" "$T.x" "$F"' EXIT
journalctl _COMM=sshd + _COMM=sshd-session --since "@$DEBUT" --until "@$JUSQUE" -o short-iso > "$T" 2>/dev/null
JAIL=$(fail2ban-client status sshd 2>/dev/null | grep -oE "Total failed:[[:space:]]*[0-9]+" | grep -oE "[0-9]+")
fail2ban-client get sshd ignoreip 2>/dev/null | sed -n 's/^[|`]- //p' | grep -v / > "$F"
if [ -s "$F" ]; then grep -vwF -f "$F" "$T" > "$T.x"; mv "$T.x" "$T"; fi
# Ni la boucle locale, ni « -- No entries -- » de journalctl.
grep -vE ' (127\.[0-9]+\.[0-9]+\.[0-9]+|::1)( |$)|^-- |^$' "$T" > "$T.x"; mv "$T.x" "$T"
# Un journal vide vaut zero, sans demander a fail2ban-regex ce qu'il en dit.
if [ -s "$T" ]; then
    VUS=$(fail2ban-regex --print-no-missed --print-no-ignored "$T" "sshd[mode=normal]" 2>/dev/null |
        sed -n 's/^Lines: .* \([0-9][0-9]*\) matched.*/\1/p')
else
    VUS=0
fi
echo "jail=${JAIL:-} journal=${VUS:-} minutes=$(( ($(date +%s) - DEBUT) / 60 ))"
DISTANT
}
COMPTES=$(compter 2>&1)
JAIL=$(sed -n 's/.*jail=\([0-9]*\) .*/\1/p' <<< "$COMPTES")
VUS=$(sed -n 's/.*journal=\([0-9]*\) .*/\1/p' <<< "$COMPTES")
MINUTES=$(sed -n 's/.*minutes=\([0-9]*\).*/\1/p' <<< "$COMPTES")
A_REVOIR=0
if [ -z "$JAIL" ] || [ -z "$VUS" ]; then
    ECHOUEES=$((ECHOUEES+1)); echo "  ECHEC les comptes sont illisibles -- obtenu \"${COMPTES:0:200}\""
elif [ "$JAIL" -gt 0 ]; then
    REUSSIES=$((REUSSIES+1)); echo "  ok    la jail voit des echecs ($JAIL depuis son demarrage)"
elif [ "$VUS" -gt 0 ]; then
    ECHOUEES=$((ECHOUEES+1)); echo "  ECHEC la jail ne compte AUCUN echec, le journal en porte $VUS -- elle lit au mauvais endroit"
else
    A_REVOIR=1; echo "  --    rien a juger : aucun echec au journal depuis le demarrage de fail2ban (il y a ${MINUTES:-?} min)"
fi

BANNIES=$($SSH "$CIBLE" 'sudo -n fail2ban-client status sshd 2>/dev/null | grep -oE "Currently banned:[[:space:]]*[0-9]+" | grep -oE "[0-9]+"' 2>&1)
echo "  --    actuellement bannies : ${BANNIES:-?}"

# L'adresse, en ligne entiere : « 192.0.2.1 » ne doit pas passer pour « 192.0.2.10 ».
IGNOREE=$($SSH "$CIBLE" "sudo -n fail2ban-client get sshd ignoreip 2>/dev/null | sed -n 's/^[|\`]- //p' | grep -cxF '$ADRESSE'" 2>&1)
verifier "l'appelant de la ronde est ignore" "1" "$IGNOREE"

echo
echo "$REUSSIES reussies, $ECHOUEES echouees"
[ "$ECHOUEES" -eq 0 ] || exit 1
# Ni succes ni echec : la jail n'a encore rien eu a compter.
[ "$A_REVOIR" -eq 0 ] || { echo "a relancer plus tard : rien n'est encore juge sur les echecs"; exit 3; }
