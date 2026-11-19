"""Épreuves adverses du veilleur des sauvegardes.

Il remplace un canal de courrier qui ne fonctionnait pas — port 25 sortant
bloqué, message coincé cinq jours dans la file de postfix, puis rebond vers un
root que personne ne lit. Un dispositif qui prend la place d'un canal muet doit
prouver qu'il parle ; c'est tout l'objet de ce fichier.

La grappe est remplacée par des fixtures : on ne peut pas faire échouer une
sauvegarde réelle sur commande, et un défaut qu'on ne peut pas provoquer n'est
jamais éprouvé.
"""

from __future__ import annotations

import importlib.util
import time
from pathlib import Path

import pytest

# Moved into Cénacle (ADR-0045): the script sits next to this file.
VEILLEUR = Path(__file__).parent / "veiller-les-sauvegardes.py"

MAINTENANT = int(time.time())
HIER = MAINTENANT - 86400
IL_Y_A_LONGTEMPS = MAINTENANT - 30 * 86400


@pytest.fixture
def veilleur(tmp_path):
    """Le programme, chargé comme un module, son état dans un temporaire."""
    cadre = importlib.util.spec_from_file_location("veiller_les_sauvegardes", VEILLEUR)
    module = importlib.util.module_from_spec(cadre)
    cadre.loader.exec_module(module)
    module.ETAT = tmp_path / "etat"
    module.VERDICT = module.ETAT / "verdict"
    return module


def grappe(*, taches=None, noeuds=None, machines=None, par_noeud=None, illisibles=()):
    """Une grappe de comédie, telle que `pvesh` la rendrait."""
    taches = ([{"id": "backup-001", "enabled": "1", "vmid": "100,200"}]
              if taches is None else taches)
    noeuds = {"noeud-a": "online"} if noeuds is None else noeuds
    machines = {100: "noeud-a", 200: "noeud-a"} if machines is None else machines
    par_noeud = ({"noeud-a": [{"status": "OK", "endtime": HIER}]}
                 if par_noeud is None else par_noeud)

    def demander(chemin, *options):
        if chemin == "/cluster/backup":
            return taches
        if chemin == "/cluster/resources" and "node" in options:
            return [{"node": n, "status": e} for n, e in noeuds.items()]
        if chemin == "/cluster/resources" and "vm" in options:
            return [{"vmid": v, "node": n} for v, n in machines.items()]
        if chemin.startswith("/nodes/"):
            noeud = chemin.split("/")[2]
            if noeud in illisibles:
                raise RuntimeError("le noeud ne repond pas")
            return par_noeud.get(noeud, [])
        raise AssertionError(f"chemin inattendu : {chemin}")

    return demander


def passer(veilleur, demander):
    """Un passage complet, comme systemd l'appellerait."""
    veilleur.demander = demander
    code = veilleur.main()
    return code, veilleur.VERDICT.read_text(encoding="utf-8").splitlines()


def champ(lignes, cle):
    for ligne in lignes:
        nom, _, valeur = ligne.partition("=")
        if nom == cle:
            return valeur
    return None


def motifs(lignes):
    return [ligne[len("motif="):] for ligne in lignes if ligne.startswith("motif=")]


# -- ce qui doit passer ---------------------------------------------------------


def test_une_grappe_saine_est_declaree_saine(veilleur):
    code, lignes = passer(veilleur, grappe())

    assert champ(lignes, "verdict") == "SAIN"
    assert code == 0
    assert motifs(lignes) == []
    assert champ(lignes, "fin") == "1"
    assert champ(lignes, "invites") == "100,200"


def test_le_verdict_n_est_jamais_lu_a_moitie_ecrit(veilleur):
    passer(veilleur, grappe())

    assert not list(veilleur.ETAT.glob("*.partiel"))


# -- ce qui doit alerter --------------------------------------------------------


def test_une_tache_desactivee_est_vue(veilleur):
    code, lignes = passer(veilleur, grappe(
        taches=[{"id": "backup-001", "enabled": "0", "vmid": "100"}]
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert code == 1
    assert any("desactivee" in m for m in motifs(lignes))


def test_aucune_tache_declaree_est_un_cri_pas_un_silence(veilleur):
    _, lignes = passer(veilleur, grappe(taches=[]))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("aucune tache de sauvegarde" in m for m in motifs(lignes))


def test_une_sauvegarde_en_echec_alerte_sans_attendre_de_seuil(veilleur):
    """Un échec est un échec **maintenant**, pas dans dix jours."""
    _, lignes = passer(veilleur, grappe(
        par_noeud={"noeud-a": [{"status": "backup failed: disk full",
                                   "endtime": MAINTENANT - 60}]}
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("a echoue" in m and "disk full" in m for m in motifs(lignes))


def test_un_noeud_sans_aucune_sauvegarde_connue_alerte(veilleur):
    _, lignes = passer(veilleur, grappe(par_noeud={"noeud-a": []}))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("aucune sauvegarde terminee" in m for m in motifs(lignes))


def test_une_sauvegarde_trop_vieille_alerte(veilleur):
    _, lignes = passer(veilleur, grappe(
        par_noeud={"noeud-a": [{"status": "OK", "endtime": IL_Y_A_LONGTEMPS}]}
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("rien depuis 30 jours" in m for m in motifs(lignes))


def test_une_tache_en_cours_ne_compte_pas_pour_une_sauvegarde_finie(veilleur):
    """Sans `endtime`, elle n'a rien prouvé. On juge la dernière **terminée**."""
    _, lignes = passer(veilleur, grappe(
        par_noeud={"noeud-a": [
            {"status": "running"},
            {"status": "OK", "endtime": IL_Y_A_LONGTEMPS},
        ]}
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("rien depuis" in m for m in motifs(lignes))


# -- ce qu'on ne peut pas juger -------------------------------------------------
#
# Refus par défaut : ne pas pouvoir juger n'est pas un blanc-seing. C'est le
# choix assumé du 18/09/2026 — une alerte tant qu'un invité du périmètre vit sur
# un nœud mort, et le remède est de l'en retirer, pas de se taire.


def test_un_invite_sur_un_noeud_hors_ligne_alerte(veilleur):
    _, lignes = passer(veilleur, grappe(
        noeuds={"noeud-a": "online", "noeud-b": "offline"},
        machines={100: "noeud-a", 200: "noeud-a", 300: "noeud-b"},
        taches=[{"id": "backup-001", "enabled": "1", "vmid": "100,200,300"}],
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("300" in m and "hors ligne" in m for m in motifs(lignes))


def test_le_noeud_en_ligne_reste_juge_malgre_le_noeud_mort(veilleur):
    """Un nœud mort n'aveugle pas le jugement des autres."""
    _, lignes = passer(veilleur, grappe(
        noeuds={"noeud-a": "online", "noeud-b": "offline"},
        machines={100: "noeud-a", 300: "noeud-b"},
        taches=[{"id": "backup-001", "enabled": "1", "vmid": "100,300"}],
        par_noeud={"noeud-a": [{"status": "OK", "endtime": HIER}]},
    ))

    assert any(ligne.startswith("noeud=noeud-a:OK:") for ligne in lignes)


def test_un_invite_introuvable_dans_la_grappe_alerte(veilleur):
    _, lignes = passer(veilleur, grappe(
        taches=[{"id": "backup-001", "enabled": "1", "vmid": "100,999"}]
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("999" in m and "introuvable" in m for m in motifs(lignes))


def test_une_tache_au_perimetre_flou_alerte(veilleur):
    """Un périmètre qu'on ne sait pas lire passerait pour « rien à juger »."""
    _, lignes = passer(veilleur, grappe(
        taches=[{"id": "backup-001", "enabled": "1"}]
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("ne dit pas quels invites" in m for m in motifs(lignes))


def test_une_tache_qui_dit_tous_est_comprise(veilleur):
    _, lignes = passer(veilleur, grappe(
        taches=[{"id": "backup-001", "enabled": "1", "all": "1", "exclude": "200"}],
        machines={100: "noeud-a", 200: "noeud-a"},
    ))

    assert champ(lignes, "invites") == "100"
    assert champ(lignes, "verdict") == "SAIN"


def test_un_noeud_illisible_alerte_sans_faire_taire_les_autres(veilleur):
    _, lignes = passer(veilleur, grappe(
        noeuds={"noeud-a": "online", "noeud-c": "online"},
        machines={100: "noeud-a", 301: "noeud-c"},
        taches=[{"id": "backup-001", "enabled": "1", "vmid": "100,301"}],
        par_noeud={"noeud-a": [{"status": "OK", "endtime": HIER}]},
        illisibles=("noeud-c",),
    ))

    assert champ(lignes, "verdict") == "MALADE"
    assert any("illisibles" in m for m in motifs(lignes))
    assert any(ligne.startswith("noeud=noeud-a:OK:") for ligne in lignes)


def test_une_grappe_muette_ne_meurt_pas_en_silence(veilleur):
    """Le pire serait de ne rien écrire : le Mac ne le verrait qu'après 3 jours."""
    def muette(*_a, **_k):
        raise RuntimeError("pvesh est introuvable")

    code, lignes = passer(veilleur, muette)

    assert champ(lignes, "verdict") == "MALADE"
    assert code == 1
    assert any("n'a pas pu juger" in m for m in motifs(lignes))
    assert champ(lignes, "fin") == "1"


# -- la datation de la panne ----------------------------------------------------


def test_la_date_du_debut_de_panne_ne_bouge_pas(veilleur):
    malade = grappe(par_noeud={"noeud-a": []})
    _, premier = passer(veilleur, malade)
    _, second = passer(veilleur, malade)

    assert champ(premier, "depuis") == champ(second, "depuis")
    assert champ(premier, "depuis") != "-"


def test_le_retour_a_la_sante_efface_la_date(veilleur):
    passer(veilleur, grappe(par_noeud={"noeud-a": []}))
    _, lignes = passer(veilleur, grappe())

    assert champ(lignes, "verdict") == "SAIN"
    assert champ(lignes, "depuis") == "-"


# -- la limite assumée ----------------------------------------------------------


def test_une_sauvegarde_manuelle_suffit_a_le_satisfaire(veilleur):
    """**Il ne distingue pas le planifié du manuel.**

    Les deux laissent une tâche `vzdump` réussie. Une sauvegarde lancée à la
    main masquerait donc un planificateur arrêté. L'épreuve fige cette limite
    pour qu'elle reste une décision, et non une surprise le jour où elle compte.
    """
    _, lignes = passer(veilleur, grappe(
        par_noeud={"noeud-a": [{"status": "OK", "endtime": MAINTENANT - 3600}]}
    ))

    assert champ(lignes, "verdict") == "SAIN"
