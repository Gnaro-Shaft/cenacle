/** Fictional settings for the tests: never the real profile nor real platforms. */
import { type ProspectionConfig, parseProspectionConfig } from "./config.ts";

export const SHARED = `
[reglage]
texte_max = 8000
annonces_max = 5
[intermediaires]
esn = ["Grande ESN", "Conseil Fictif"]
tournures = ["pour le compte de notre client", "esn"]
`;

export const LOCAL = `
[[plateforme]]
nom = "Plateforme fictive"
domaine = "plateforme.example"
hotes_liens = ["plateforme.example", "clic.plateforme.example"]
adresses_candidature = ["candidatures@plateforme.example"]
[profil]
stack = ["python", "llm"]
tjm_min = 550
teletravail = ["total", "partiel"]
lieux = ["Lyon"]
`;

export function testConfig(local = LOCAL, shared = SHARED): ProspectionConfig {
  return parseProspectionConfig(shared, local);
}
