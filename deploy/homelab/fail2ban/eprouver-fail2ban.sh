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

TROUVES=$($SSH "$CIBLE" 'sudo -n fail2ban-client status sshd 2>/dev/null | grep -oE "Total failed:[[:space:]]*[0-9]+" | grep -oE "[0-9]+"' 2>&1)
if [ "${TROUVES:-0}" -gt 0 ]; then
    REUSSIES=$((REUSSIES+1)); echo "  ok    la jail voit des echecs ($TROUVES)"
else
    # Zero echec vu alors que le journal en porte des centaines = la jail
    # regarde au mauvais endroit. C'est precisement le piege.
    ECHOUEES=$((ECHOUEES+1)); echo "  ECHEC la jail ne voit AUCUN echec -- elle lit au mauvais endroit"
fi

BANNIES=$($SSH "$CIBLE" 'sudo -n fail2ban-client status sshd 2>/dev/null | grep -oE "Currently banned:[[:space:]]*[0-9]+" | grep -oE "[0-9]+"' 2>&1)
echo "  --    actuellement bannies : ${BANNIES:-?}"

# L'adresse, en ligne entiere : « 192.0.2.1 » ne doit pas passer pour « 192.0.2.10 ».
IGNOREE=$($SSH "$CIBLE" "sudo -n fail2ban-client get sshd ignoreip 2>/dev/null | sed -n 's/^[|\`]- //p' | grep -cxF '$ADRESSE'" 2>&1)
verifier "l'appelant de la ronde est ignore" "1" "$IGNOREE"

echo
echo "$REUSSIES reussies, $ECHOUEES echouees"
[ "$ECHOUEES" -eq 0 ]
