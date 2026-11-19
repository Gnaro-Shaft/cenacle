#!/bin/bash
# Epreuves de l'attente du quorum.
#
# Le faux « pvecm » remplace le vrai : ces epreuves s'exercent sans grappe, et
# surtout sans attendre deux minutes pour voir ce que fait le delai.
set -uo pipefail

BAC="/tmp/epreuve-attente-grappe"
SCRIPT="${1:-$(dirname "$0")/attendre-la-grappe}"
REUSSIES=0; ECHOUEES=0

rm -rf "$BAC"; mkdir -p "$BAC"
faux_pvecm() {
    cat > "$BAC/pvecm" <<FAUX
#!/bin/bash
echo "$1"
FAUX
    chmod +x "$BAC/pvecm"
}

verifier() {
    if [ "$2" = "$3" ]; then
        REUSSIES=$((REUSSIES+1)); echo "  ok    $1"
    else
        ECHOUEES=$((ECHOUEES+1)); echo "  ECHEC $1 -- attendu \"$2\", obtenu \"$3\""
    fi
}

echo "-- le quorum est la --"
faux_pvecm "Quorate:          Yes"
SORTIE=$(GRAPPE_PVECM="$BAC/pvecm" GRAPPE_DELAI=5 bash "$SCRIPT" 2>&1); CODE=$?
verifier "rend la main tout de suite" "0" "$CODE"
verifier "et le dit" "oui" "$(grep -qF 'quorum apres' <<< "$SORTIE" && echo oui || echo non)"

echo "-- le quorum ne revient pas --"
faux_pvecm "Quorate:          No"
DEPART=$(date +%s)
SORTIE=$(GRAPPE_PVECM="$BAC/pvecm" GRAPPE_DELAI=5 bash "$SCRIPT" 2>&1); CODE=$?
ECOULE=$(( $(date +%s) - DEPART ))
# **Le controle qui compte.** Sortir en erreur ferait echouer l'unite, et un
# veilleur en echec est un veilleur qui ne veille pas : on echangerait une
# fausse alerte contre un silence.
verifier "rend ZERO quand meme" "0" "$CODE"
verifier "et laisse juger en le disant" "oui" "$(grep -qF 'on juge quand meme' <<< "$SORTIE" && echo oui || echo non)"
verifier "apres avoir attendu le delai" "oui" "$([ "$ECOULE" -ge 5 ] && echo oui || echo non)"
verifier "sans le depasser franchement" "oui" "$([ "$ECOULE" -lt 12 ] && echo oui || echo non)"

echo "-- pas de pvecm : machine hors grappe --"
SORTIE=$(GRAPPE_PVECM="$BAC/inexistant" GRAPPE_DELAI=99 bash "$SCRIPT" 2>&1); CODE=$?
verifier "rend la main sans attendre" "0" "$CODE"
verifier "et dit pourquoi" "oui" "$(grep -qF 'rien a attendre' <<< "$SORTIE" && echo oui || echo non)"

echo "-- pvecm ailleurs que la ou on le cherchait --"
# Le chemin etait code en dur a /usr/sbin ; il vit dans /usr/bin sur Proxmox 8.
# Le script annoncait « rien a attendre » sur un vrai noeud de grappe.
faux_pvecm "Quorate:          Yes"
SORTIE=$(GRAPPE_PVECM="$BAC/pvecm" GRAPPE_DELAI=5 bash "$SCRIPT" 2>&1)
verifier "il est trouve la ou il est" "oui" "$(grep -qF 'quorum apres' <<< "$SORTIE" && echo oui || echo non)"

echo "-- pvecm qui repond n'importe quoi --"
faux_pvecm "Quorate: peut-etre"
SORTIE=$(GRAPPE_PVECM="$BAC/pvecm" GRAPPE_DELAI=3 bash "$SCRIPT" 2>&1); CODE=$?
verifier "une reponse illisible n'est pas un quorum" "0" "$CODE"
verifier "et on juge quand meme" "oui" "$(grep -qF 'on juge quand meme' <<< "$SORTIE" && echo oui || echo non)"

echo
echo "$REUSSIES reussies, $ECHOUEES echouees"
rm -rf "$BAC"
[ "$ECHOUEES" -eq 0 ]
