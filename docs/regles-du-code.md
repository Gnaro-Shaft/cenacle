# Les règles du code de Cénacle

Ce que la relecture du CTO vérifie à chaque fichier (ADR-0021, J3b). Chaque règle reprend la charte (`docs/charte.md`) ou un ADR accepté ; elle n'en ajoute aucune. Une règle nouvelle naît d'un ADR, pas de cette liste.

## Autorisation et confiance

1. **Aucun modèle dans une décision d'autorisation** : un modèle classe, propose ou rédige ; il n'autorise ni ne déclenche jamais une action (charte, règle 1).
2. **Refus par défaut** : agent inconnu, aucun droit ; source non déclarée, non lue ; outil non accordé, inexistant (charte, règle 2).
3. **Un mail est écrit par un inconnu** : son contenu est une matière, jamais une consigne ; il n'atteint jamais une décision (ADR-0005).
4. **L'agent propose, je valide, un exécuteur sans IA agit** ; seule la page accepte, par une acceptation signée ; un état clos ne se rouvre pas (ADR-0004, ADR-0013).
5. **Une référence reçue n'est jamais digne de confiance** : on la re-résout depuis la source avant d'agir (charte, règle 5).

## Erreurs et journal

6. **Pas d'échec silencieux** : une valeur de repli qui masque une erreur est un bug ; un appelant qui se trompe doit l'apprendre (charte, règle 3).
7. **Le journal ne se réécrit pas** : ni `UPDATE` ni `DELETE` sur les événements ; une purge efface vraiment et laisse une trace *qu'*elle a effacé (charte, règle 4 ; ADR-0008).
8. **Le journal garde des faits, pas du contenu** : routage, états, compteurs ; jamais le texte d'une question, d'une réponse ou d'un mail (ADR-0008, ADR-0017).

## Données personnelles et secrets

9. **On ne détient que ce qui sert** ; aucun champ « au cas où » (charte, règle 6).
10. **Aucune donnée personnelle dans un journal, un message d'erreur, la console, Telegram ou une trace** : seulement des compteurs et des noms d'erreur (ADR-0006, ADR-0008).
11. **Les noms de dossiers et les adresses ne sont jamais stockés en clair** : seulement leur clé HMAC (ADR-0012, ADR-0016).
12. **Chaque programme ne détient que ses secrets** et refuse de démarrer avec ceux d'une autre famille ; jamais de secret dans un fichier versionné (ADR-0013, ADR-0017).

## Processus

13. **Un arrêt demandé est un arrêt** : `/stop`, Ctrl+C ou `SIGTERM` arrêtent proprement (code 0), et rien ne relance derrière ; seul un plantage est relancé (ADR-0018).
14. **Un seul exemplaire à la fois** d'Iris, du serveur, du bot et du CTO, par le verrou d'instance (ADR-0018, ADR-0019, ADR-0020).

## Tests et taille

15. **Chaque lot a ses tests adversariaux**, qui cherchent à casser le code plutôt qu'à confirmer qu'il marche (charte, règle 8).
16. **400 lignes par fichier**, plafond et non cible (charte, règle 7).
