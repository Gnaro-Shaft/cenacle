/**
 * The Parc's machine cards (ADR-0039): one per machine, its gauges
 * (processor, memory, disks), its virtual machines when it is a Proxmox node,
 * Legion's word and motifs below. Plain text everywhere (React escapes it).
 */
import type { ParcView } from "./api.ts";
import { cardTone, gaugeTone, type MachineCard, machinesOf } from "./parc-machines.ts";
import { stateLabel, stateTone, type Tone } from "./parc-rules.ts";

function Dot({ tone, label }: { readonly tone: Tone; readonly label: string }) {
  return <span className={`point ton-${tone}`} role="img" aria-label={label} />;
}

function Gauge({ label, percent }: { readonly label: string; readonly percent: number }) {
  return (
    <div className="jauge">
      <span className="jauge-nom">{label}</span>
      <span className="jauge-barre" aria-hidden="true">
        <span
          className={`jauge-plein ton-${gaugeTone(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="jauge-valeur">{percent} %</span>
    </div>
  );
}

function Guests({ node }: { readonly node: NonNullable<MachineCard["node"]> }) {
  if (node.guests.length === 0) return null;
  return (
    <ul className="parc-lignes machine-invites">
      {node.guests.map((g) => (
        <li key={g.id} className="parc-ligne">
          <Dot tone={g.running ? "bon" : "inconnu"} label={g.running ? "en marche" : "arrêtée"} />
          <span className="parc-nom">
            {g.name}{" "}
            <span className="parc-etiquette">
              ({g.kind === "vm" ? "VM" : "CT"} {g.id})
            </span>
          </span>
          <span className="parc-valeur">
            {g.running
              ? `${g.cpuPercent === null ? "—" : `${g.cpuPercent} %`} · ${g.memoryPercent === null ? "—" : `${g.memoryPercent} %`}`
              : "arrêtée"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function diskTone(d: { readonly healthy: boolean | null; readonly wearLeft: number | null }): Tone {
  if (d.healthy === false) return "mauvais";
  // A health Proxmox cannot assess is unknown, never healthy.
  if (d.healthy === null) return "inconnu";
  return d.wearLeft !== null && d.wearLeft < 20 ? "attention" : "bon";
}

function Disks({ node }: { readonly node: NonNullable<MachineCard["node"]> }) {
  if (node.disks === null || node.disks.length === 0) return null;
  return (
    <ul className="parc-lignes">
      {node.disks.map((d) => (
        <li key={d.device} className="parc-ligne">
          <Dot
            tone={diskTone(d)}
            label={d.healthy === false ? "en défaut" : d.healthy === null ? "état inconnu" : "sain"}
          />
          <span className="parc-nom">{d.model || d.device}</span>
          <span className="parc-valeur">
            {d.wearLeft === null ? d.kind : `usure ${100 - d.wearLeft} %`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ m }: { readonly m: MachineCard }) {
  const legionTone: Tone | null =
    m.legion === null ? null : stateTone(m.legion.state, m.legion.stale);
  const tone = cardTone(m, legionTone);
  return (
    <article className={`bloc parc-carte machine ton-cadre-${tone}`} aria-label={m.name}>
      <h3 className="machine-titre">
        <Dot tone={tone} label={m.legion === null ? "état inconnu" : stateLabel(m.legion.state)} />
        <span className="parc-nom">{m.name}</span>
        {m.legion !== null && <span className="parc-valeur">{stateLabel(m.legion.state)}</span>}
      </h3>
      {m.cpu !== null && <Gauge label="Processeur" percent={m.cpu} />}
      {m.memory !== null && <Gauge label="Mémoire" percent={m.memory} />}
      {m.disks.map((d) => (
        <Gauge key={d.label} label={`Disque ${d.label}`} percent={d.percent} />
      ))}
      {m.cpu === null && m.memory === null && m.disks.length === 0 && (
        <p className="parc-vide">Aucune mesure pour cette machine.</p>
      )}
      {m.node !== null && <Guests node={m.node} />}
      {m.node !== null && <Disks node={m.node} />}
      {m.unread.map((u) => (
        <p key={u} className="parc-note perime">
          {u}
        </p>
      ))}
      {m.legion !== null && m.legion.motifs.length > 0 && (
        <ul className="parc-motifs">
          {m.legion.motifs.map((motif) => (
            <li key={motif}>{motif}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

const PROXMOX_UNREAD: Readonly<Record<string, string>> = {
  config: "La configuration de Proxmox est fausse (voir docs/securite/secrets.md).",
  injoignable: "Proxmox ne répond pas : aucun nœud joint.",
  refuse: "Proxmox refuse le jeton : révoqué ou sans droit ?",
  illisible: "La réponse de Proxmox est illisible.",
};

export function Machines({ view }: { readonly view: ParcView }) {
  const cards = machinesOf(view);
  const proxmox = view.proxmox?.read;
  return (
    <>
      {proxmox !== undefined && proxmox !== "ok" && proxmox !== "absent" && (
        <p className="message">{PROXMOX_UNREAD[proxmox]}</p>
      )}
      {view.machines?.config === "illisible" && (
        <p className="message">parc.local.toml est illisible : aucun bulletin n'est lu.</p>
      )}
      {cards.length === 0 ? (
        <p className="bloc parc-vide">Aucune machine connue pour l'instant.</p>
      ) : (
        cards.map((m) => <Card key={m.name} m={m} />)
      )}
    </>
  );
}
