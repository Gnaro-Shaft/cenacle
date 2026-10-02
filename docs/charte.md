# Charte — les règles dures de Cénacle

Elles valent pour tout le code, sans exception. En cas de doute, la règle la plus protectrice l'emporte.
Elles sont reprises d'un projet précédent (Legion), où chacune a été payée par un incident ou une revue.

1. **Aucun modèle dans une décision d'autorisation.** Un modèle peut chercher, classer, proposer, rédiger. Jamais autoriser ni déclencher une action. Il est manipulable par ce qu'il lit — et un mail est écrit par un inconnu.
2. **Refus par défaut.** Agent inconnu = aucun droit. Source non déclarée = non lue. Outil non accordé = n'existe pas.
3. **Pas d'échec silencieux.** Une valeur de repli qui masque une erreur est un bug. Un appelant qui se trompe doit l'apprendre.
4. **Le journal ne se réécrit pas.** Pas d'`UPDATE` ni de `DELETE` sur les événements. La purge prévue par le registre des traitements efface vraiment — et laisse une trace *qu'*elle a effacé, pas *ce qu'*elle a effacé.
5. **Une référence reçue n'est jamais digne de confiance.** On re-résout depuis la source avant d'agir, y compris pour ses propres références.
6. **On ne détient que ce qui sert.** Ce qui n'est pas nécessaire à la finalité n'entre pas : la meilleure protection est de ne pas détenir.
7. **400 lignes par fichier**, plafond et non cible. On découpe avant de dépasser.
8. **Une tâche est finie quand elle a été exécutée**, pas quand elle est écrite. Chaque lot a ses tests adversariaux (`*.adversarial.test.ts`), qui cherchent à casser le code plutôt qu'à confirmer qu'il marche.
