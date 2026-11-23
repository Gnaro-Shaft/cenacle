// The fake roots of the inventory's tests (ADR-0046, L1): bash run inside the
// throwaway Debian, in the root being built ($PWD). Every value is made up; the
// SECRET markers stand for what must never leave a machine.

/** A machine Legion never touched — or one cleaned: Cénacle's keys, the pieces kept on purpose. */
export const CLEAN = [
  "mkdir -p etc/systemd/system/timers.target.wants etc/sudoers.d etc/needrestart/conf.d usr/local/bin usr/local/sbin",
  "mkdir -p root/.ssh home/humain/.ssh home/cenacle/.ssh var/lib var/backups etc/apt/apt.conf.d etc/udev/rules.d run/systemd/transient",
  "printf '%s\\n' 'root:x:0:0:root:/root:/bin/bash' 'humain-secret:x:1000:1000::/home/humain:/bin/bash' 'cenacle:x:1001:1001::/home/cenacle:/usr/sbin/nologin' 'rondelle:x:1003:1003:la ronde:/var/ronde:/usr/sbin/nologin' 'nobody:x:65534:65534::/nonexistent:/usr/sbin/nologin' > etc/passwd",
  `echo 'command="/usr/local/bin/cenacle-bulletin",restrict ssh-ed25519 AAAAcenacle cenacle-ronde' > root/.ssh/authorized_keys`,
  "echo 'ssh-ed25519 AAAAhumain humain@poste' > home/humain/.ssh/authorized_keys",
  `echo 'command="/usr/local/bin/cenacle-bulletin",restrict ssh-ed25519 AAAAcenacle cenacle-ronde' > home/cenacle/.ssh/authorized_keys`,
  "touch etc/apt/apt.conf.d/52legion-redemarrage etc/udev/rules.d/90-legion-rebrancher-nic0.rules",
  "touch etc/systemd/system/rebrancher-nic0.service etc/systemd/system/rebrancher-nic0.timer usr/local/sbin/rebrancher-nic0",
  "touch usr/local/bin/attendre-la-grappe etc/systemd/system/legion-maj-noeud.service run/systemd/transient/legion-maj-1.service",
  "touch etc/needrestart/conf.d/zz-cenacle.conf",
  "ln -s ../rebrancher-nic0.timer etc/systemd/system/timers.target.wants/rebrancher-nic0.timer",
  "ln -s ../legion-maj-noeud.service etc/systemd/system/timers.target.wants/legion-maj-noeud.service",
  "chmod 755 . root home/humain home/humain/.ssh && chmod 644 etc/passwd",
].join("\n");

/** Names of the kept pieces: never in the inventory's output. */
export const KEPT = ["52legion", "rebrancher", "attendre-la-grappe", "legion-maj", "zz-cenacle"];

/** Bytes that must never leave: key material, key lines, data, an account name. */
export const SECRETS = [
  "AAAAcleSECRET",
  "SECRETcleprivee",
  "SECRETdonnee",
  "nom-secret",
  "humain-secret",
  "restrict",
  "rrsync",
];

export interface Trace {
  /** How the inventory's PRÉSENTE line begins. */
  label: string;
  /** Bash that leaves this trace on a clean root. */
  make: string;
  /** Under /root or a home's .ssh: unreadable when not root (chmod 700). */
  hidden?: boolean;
  /** The fake tailscale client this trace needs. */
  tailscale?: string;
}

const keyLine = (marks: string) => `restrict ssh-ed25519 AAAAcleSECRET ${marks}`;
// A sub-folder nobody may read: an error of du would name it.
const data = (dir: string) =>
  `mkdir -p ${dir}/nom-secret-sous && echo SECRETdonnee > ${dir}/nom-secret.db && chmod 700 ${dir}/nom-secret-sous && chmod 755 ${dir}`;

const UNITS = [
  "legion.service",
  "legion.timer",
  "legion-sante.service",
  "legion-sante.timer",
  "legion-travaux.service",
  "legion-travaux.timer",
  "legion-fenetre.service",
  "veilleur-legion.service",
  "veilleur-legion.timer",
  "copie-bases.service",
  "copie-bases.timer",
];

const DIRS: [string, string, boolean][] = [
  ["var/lib/legion-ronde", "/var/lib/legion-ronde (son sel)", false],
  ["var/lib/veilleur-legion", "/var/lib/veilleur-legion", false],
  ["var/lib/copie-bases", "/var/lib/copie-bases (ne part qu'après S3)", false],
  ["root/veilleur", "/root/veilleur", true],
  ["root/copie-bases", "/root/copie-bases", true],
  ["root/projects/legion", "/root/projects/legion (son code et son .env)", true],
  ["root/storage/legion/.legion", "/root/storage/legion/.legion (sa base et ses copies)", true],
  ["var/backups/legion-bases", "/var/backups/legion-bases (les copies de ses bases)", false],
];

/** Every trace the ADR's context names, one by one. */
export const TRACES: Trace[] = [
  {
    label: "authorized_keys de root",
    make: `echo 'command="/usr/local/bin/legion-bulletin-hote",${keyLine("ronde-legion")}' >> root/.ssh/authorized_keys`,
    hidden: true,
  },
  {
    label: "authorized_keys2 de root",
    make: `echo 'command="rrsync -ro /root/storage/legion/.legion/copies",${keyLine("copie-bases noeud")}' > root/.ssh/authorized_keys2`,
    hidden: true,
  },
  {
    label: "authorized_keys de la grappe (/etc/pve/priv)",
    make: `mkdir -p etc/pve/priv && echo 'command="/usr/local/bin/legion-bulletin",${keyLine("veilleur-legion")}' > etc/pve/priv/authorized_keys`,
  },
  {
    label: "authorized_keys de ronde",
    make: `mkdir -p home/ronde/.ssh && echo '${keyLine("ronde-legion")}' > home/ronde/.ssh/authorized_keys`,
  },
  {
    label: "authorized_keys du compte d'uid 1000",
    make: `echo '${keyLine("ronde-legion")}' >> home/humain/.ssh/authorized_keys`,
    hidden: true,
  },
  ...["ronde", "veilleur-legion", "copie-bases"].flatMap((k) => [
    {
      label: `clé privée /root/.ssh/${k}`,
      make: `echo SECRETcleprivee > root/.ssh/${k}`,
      hidden: true,
    },
    {
      label: `clé publique /root/.ssh/${k}.pub`,
      make: `echo '${keyLine(k)}' > root/.ssh/${k}.pub`,
      hidden: true,
    },
  ]),
  { label: "le compte ronde", make: "echo 'ronde:x:1002:1002::/home/ronde:/bin/sh' >> etc/passwd" },
  { label: "le dossier /home/ronde", make: "mkdir -p home/ronde" },
  { label: "/etc/sudoers.d/ronde-redemarrages", make: "touch etc/sudoers.d/ronde-redemarrages" },
  { label: "/etc/sudoers.d/ronde-grappe", make: "touch etc/sudoers.d/ronde-grappe" },
  { label: "tailscale serve vers 127.0.0.1:8787", make: "true", tailscale: "ts-legion" },
  ...["legion-bulletin-hote", "legion-bulletin", "veilleur-legion", "copier-les-bases"].map(
    (f) => ({
      label: `/usr/local/bin/${f}`,
      make: `touch usr/local/bin/${f}`,
    }),
  ),
  {
    label: "/etc/needrestart/conf.d/legion.conf",
    make: "touch etc/needrestart/conf.d/legion.conf",
  },
  ...UNITS.map((u) => ({ label: `unité ${u}`, make: `touch etc/systemd/system/${u}` })),
  {
    label: "unité inattendue legion-autre.service",
    make: "touch etc/systemd/system/legion-autre.service",
  },
  { label: "surcharge legion.service.d", make: "mkdir -p etc/systemd/system/legion.service.d" },
  {
    label: "lien d'activation timers.target.wants/legion.timer",
    make: "ln -s /etc/systemd/system/legion.timer etc/systemd/system/timers.target.wants/legion.timer",
  },
  ...DIRS.map(([dir, label, hidden]) => ({ label, make: data(dir), hidden })),
];

/** A machine Legion lived on: every trace at once. */
export const DIRTY = [CLEAN, ...TRACES.map((t) => t.make)].join("\n");
