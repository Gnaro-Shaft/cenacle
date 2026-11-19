#!/usr/bin/env python3
"""Le veilleur des sauvegardes : la tâche a-t-elle tourné, et a-t-elle réussi ?

Il vit sur le nœud de sauvegarde et interroge la grappe en lecture seule.

**Pourquoi il existe.** Proxmox sait déjà signaler un échec de sauvegarde : la
tâche porte `mailnotification=failure` et une adresse. Éprouvé le 18/09/2026,
ce canal ne fonctionne pas — et n'a jamais fonctionné. Le message part, postfix
n'a pas de `relayhost`, il tente la remise directe, **le port 25 sortant est
bloqué**, et le courrier attend cinq jours dans la file avant de rebondir vers
un root local que personne ne lit. Personne ne s'en était aperçu pour une
raison simple : rien n'avait jamais échoué. Le canal n'aurait pas servi le jour
où il aurait fallu.

Plutôt que d'ouvrir une route SMTP — ce qui suppose un mot de passe en clair
sur deux nœuds —, le verdict emprunte le seul canal de cette maison qui ait
prouvé qu'il atteint quelqu'un : un fichier horodaté que le Mac relève, et une
note dans le vault.

**Ce qu'il ne fait pas.** Il ne rejuge pas les sauvegardes et n'en déclenche
aucune. Il constate ce que la grappe dit d'elles.

**Ce qu'il ne peut pas distinguer** : une sauvegarde planifiée d'une sauvegarde
lancée à la main. Les deux laissent une tâche `vzdump` réussie sur le nœud.
Une sauvegarde manuelle récente masquerait donc un planificateur arrêté — c'est
la limite de cette source, et elle est écrite ici plutôt que découverte.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ETAT = Path(os.environ.get("SAUVEGARDES_ETAT", "/var/lib/veiller-sauvegardes"))
VERDICT = ETAT / "verdict"
PVESH = os.environ.get("SAUVEGARDES_PVESH", "/usr/bin/pvesh")

#: Dix jours, le même seuil que la copie des sauvegardes. Le facteur 3 de la
#: maison vaut pour des cadences courtes ; sur une tâche hebdomadaire il
#: donnerait trois semaines de panne silencieuse. Dix jours, c'est un samedi
#: manqué plus la marge d'un rattrapage.
PEREMPTION = int(os.environ.get("SAUVEGARDES_PEREMPTION", 10 * 86400))


def demander(chemin: str, *options: str):
    """Interroge la grappe. Lecture seule, et rien d'autre n'est appelé."""
    # **Pourquoi cet appel est sûr.** Ruff signale tout `subprocess` (S603), et
    # il a raison de le faire. Ici rien ne vient de l'extérieur : `PVESH` est un
    # chemin absolu fixe, `chemin` et `options` sont des littéraux écrits dans
    # ce fichier, et la forme liste n'ouvre aucun shell. Le signalement est
    # éteint **au site**, jamais globalement — la valeur de la règle est
    # d'attraper le suivant.
    fini = subprocess.run(  # noqa: S603
        [PVESH, "get", chemin, "--output-format", "json", *options],
        capture_output=True, text=True, timeout=60, check=False,
    )
    if fini.returncode != 0:
        raise RuntimeError(f"{chemin} : {(fini.stderr or fini.stdout).strip()[:200]}")
    return json.loads(fini.stdout or "null")


def invites_de(tache: dict, tous: set[int]) -> set[int]:
    """Les invités qu'une tâche couvre.

    Une tâche peut désigner ses invités un par un, ou dire « tous » avec une
    liste d'exclusions. Ne pas savoir lequel des deux est un motif d'alerte,
    jamais un périmètre vide : un périmètre vide passerait pour « rien à
    juger », donc pour sain.
    """
    if tache.get("vmid"):
        return {int(v) for v in str(tache["vmid"]).split(",") if v.strip()}
    if str(tache.get("all", "0")) == "1":
        exclus = {int(v) for v in str(tache.get("exclude", "")).split(",") if v.strip()}
        return tous - exclus
    raise ValueError(f"la tache {tache.get('id')} ne dit pas quels invites elle couvre")


def _perimetre(taches: list[dict], machines: set[int]) -> tuple[set[int], list[str]]:
    """Les invités que les tâches activées couvrent, et ce qui cloche."""
    motifs: list[str] = []
    perimetre: set[int] = set()
    for tache in taches:
        if str(tache.get("enabled", "0")) != "1":
            motifs.append(f"la tache {tache.get('id', '?')} est desactivee")
            continue
        try:
            perimetre |= invites_de(tache, machines)
        except ValueError as flou:
            motifs.append(str(flou))
    if not perimetre and not motifs:
        motifs.append("aucune tache activee ne couvre le moindre invite")
    return perimetre, motifs


def _ou_juger(perimetre: set[int], machines: dict, noeuds: dict) -> tuple[dict, list[str]]:
    """Les nœuds à interroger, et les invités qu'on ne peut pas juger.

    **Refus par défaut** : ne pas pouvoir juger n'est pas un blanc-seing.
    """
    motifs: list[str] = []
    a_juger: dict[str, list[int]] = {}
    for vmid in sorted(perimetre):
        noeud = machines.get(vmid)
        if noeud is None:
            motifs.append(
                f"l'invite {vmid} figure a la tache mais est introuvable dans la grappe"
            )
        elif noeuds.get(noeud) != "online":
            motifs.append(
                f"l'invite {vmid} vit sur {noeud}, hors ligne :"
                " sa sauvegarde ne peut pas etre jugee"
            )
        else:
            a_juger.setdefault(noeud, []).append(vmid)
    return a_juger, motifs


def _juger_un_noeud(noeud: str, maintenant: int) -> tuple[list[str], list[str]]:
    """La dernière sauvegarde terminée de ce nœud : a-t-elle réussi, et quand ?"""
    try:
        taches = demander(f"/nodes/{noeud}/tasks",
                          "--typefilter", "vzdump", "--limit", "10") or []
    except RuntimeError as muet:
        return [f"{noeud} : ses taches sont illisibles — {muet}"], []

    finies = [t for t in taches if t.get("endtime")]
    if not finies:
        return [f"{noeud} : aucune sauvegarde terminee n'est connue"], []

    derniere = max(finies, key=lambda t: t["endtime"])
    statut = derniere.get("status") or "(statut absent)"
    fin = int(derniere["endtime"])
    age = maintenant - fin

    motifs = []
    if statut != "OK":
        # **Sans seuil d'age.** Un echec est un echec maintenant, pas dans dix
        # jours. C'est la lecon du « .env » illisible du 07/09/2026.
        motifs.append(f"{noeud} : la derniere sauvegarde a echoue — {statut}")
    if age > PEREMPTION:
        motifs.append(f"{noeud} : rien depuis {age // 86400} jours"
                      f" (seuil {PEREMPTION // 86400} j)")
    return motifs, [f"noeud={noeud}:{statut}:{fin}"]


def juger() -> tuple[list[str], list[str]]:
    """Rend les motifs d'alerte et les lignes d'information du verdict."""
    taches = demander("/cluster/backup") or []
    if not taches:
        return ["aucune tache de sauvegarde n'est declaree dans la grappe"], []

    noeuds = {n["node"]: n.get("status")
              for n in demander("/cluster/resources", "--type", "node") or []}
    machines = {int(v["vmid"]): v.get("node")
                for v in demander("/cluster/resources", "--type", "vm") or []}

    perimetre, motifs = _perimetre(taches, set(machines))
    dit = [f"invites={','.join(str(v) for v in sorted(perimetre))}"]

    a_juger, empeches = _ou_juger(perimetre, machines, noeuds)
    motifs += empeches

    maintenant = int(time.time())
    for noeud in sorted(a_juger):
        siens, sa_ligne = _juger_un_noeud(noeud, maintenant)
        motifs += siens
        dit += sa_ligne

    return motifs, dit


def _ancien_verdict() -> tuple[str | None, str | None]:
    """Ce que disait le verdict précédent : son état, et depuis quand."""
    if not VERDICT.exists():
        return None, None
    etat = depuis = None
    for ligne in VERDICT.read_text(encoding="utf-8").splitlines():
        cle, _, valeur = ligne.partition("=")
        if cle == "verdict":
            etat = valeur
        elif cle == "depuis":
            depuis = valeur
    return etat, depuis


def consigner(motifs: list[str], dit: list[str]) -> str:
    """Écrit le verdict, au format que le Mac lit déjà pour les deux autres."""
    etat = "SAIN" if not motifs else "MALADE"
    maintenant = int(time.time())

    # Depuis quand ça va mal. Une panne datée se diagnostique ; une panne sans
    # date laisse croire qu'elle vient d'arriver.
    depuis = "-"
    if etat != "SAIN":
        ancien_etat, ancien_depuis = _ancien_verdict()
        depuis = (
            ancien_depuis
            if ancien_etat and ancien_etat != "SAIN" and ancien_depuis
            and ancien_depuis != "-"
            else str(maintenant)
        )

    lignes = [f"verdict={etat}", f"instant={maintenant}", f"depuis={depuis}", *dit]
    lignes += [f"motif={m}" for m in motifs]
    lignes.append("fin=1")

    ETAT.mkdir(parents=True, exist_ok=True)
    partiel = VERDICT.with_name(VERDICT.name + ".partiel")
    partiel.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    # Remplacement atomique : le Mac ne doit jamais lire un verdict a moitie ecrit.
    partiel.replace(VERDICT)
    return etat


def main() -> int:
    try:
        motifs, dit = juger()
    # Toutes les pannes, sans exception : un veilleur qui meurt sans rien écrire
    # laisse le Mac sur un verdict périmé, qu'il ne signalera qu'au bout de
    # trois jours. Dire qu'on n'a pas pu juger vaut mieux que se taire.
    except Exception as panne:
        motifs, dit = [f"le veilleur n'a pas pu juger : {panne}"], []
    etat = consigner(motifs, dit)
    print(VERDICT.read_text(encoding="utf-8"), end="")
    return 0 if etat == "SAIN" else 1


if __name__ == "__main__":
    sys.exit(main())
