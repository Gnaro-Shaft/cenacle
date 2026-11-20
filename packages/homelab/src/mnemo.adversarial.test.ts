// ADR-0045, H4: Mnemo and Ollama closed to the local network, moved from
// Legion. The box plays the Mac, the Mnemo machine and the witness at once;
// ssh, tailscale, ss, curl and the witness's TCP attempts are fakes, steered
// by FAUX_* variables. What is proven: the template filled with what the
// machine answers, and nothing else; every refusal before anything is posed;
// the copies; the .env never displayed; each failed proof stops the script.
// No real address: 100.64.0.0/10 and 192.168.77.0/24. Skipped without Docker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Box, buildImage, docker, q, startBox } from "./test-homelab.ts";

let box: Box;
const M = "/d/homelab/mnemo";
const S = "/etc/systemd/system";
const MARQUEUR = "MARQUEUR-DU-ENV-42";
const FAKES: Record<string, string> = {
  // Runs the remote command here, as root; the last argument is the command.
  ssh: `echo "ssh $*" >> /tmp/appels-ssh; while [ $# -gt 1 ]; do shift; done; exec bash -c "$1"`,
  scp: `echo "scp $*" >> /tmp/appels-ssh
files=(); for a in "$@"; do [ "\${a#-}" = "$a" ] && files+=("$a"); done
[ -n "\${FAUX_SCP_PANNE:-}" ] && exit 1
dest="\${files[-1]#*:}"; unset 'files[-1]'; cp "\${files[@]}" "$dest"`,
  tailscale: `[ -n "\${FAUX_TS_PANNE:-}" ] && exit 1; printf '%s\\n' "\${FAUX_TAILNET-100.64.0.10}"`,
  hostname: `printf '%s\\n' "\${FAUX_ADRESSES-172.17.0.2 192.168.77.7 100.64.0.10}"`,
  systemctl: `echo "systemctl $*" >> /tmp/appels`,
  ss: `for a in \${FAUX_ECOUTE-100.64.0.10:8000 100.64.0.10:8001 100.64.0.10:8002 127.0.0.1:11434}; do
  echo "LISTEN 0 4096 $a 0.0.0.0:*"; done`,
  // The witness's attempts: open only the ports of FAUX_OUVERTS.
  timeout: `for a; do case "$a" in *"/dev/tcp/"*) t="\${a#*/dev/tcp/}"; t="\${t%%[!0-9./]*}" ;; esac; done
echo "$t" >> /tmp/appels-tcp
for o in \${FAUX_OUVERTS-22}; do [ "$o" = "\${t##*/}" ] && exit 0; done; exit 1`,
  curl: `url="\${@: -1}"; echo "curl $url" >> /tmp/appels-curl
case "$*" in
  *"-D -"*) [ -n "\${FAUX_SANS_SESSION:-}" ] || printf 'HTTP/1.1 200 OK\\r\\nmcp-session-id: s-123\\r\\n\\r\\n'; exit 0 ;;
  *tools/call*) printf '%s' "\${FAUX_STATS-{\\"jsonrpc\\":\\"2.0\\",\\"id\\":2,\\"result\\":{\\"content\\":[]}}}"; exit 0 ;;
  *notifications*) exit 0 ;;
  *"-w"*) port="\${url#*://*:}"; port="\${port%%/*}"
    for kv in \${FAUX_CODES-8000=200 8001=406 8002=200 11434=000}; do [ "\${kv%%=*}" = "$port" ] && printf '%s' "\${kv#*=}"; done; exit 0 ;;
esac
[ -n "\${FAUX_OLLAMA_MUET:-}" ] && exit 7; exit 0`,
};

beforeAll(() => {
  if (!docker) return;
  buildImage();
  box = startBox();
  for (const [name, body] of Object.entries(FAKES)) {
    box.sh(`mkdir -p /fake && printf '%s\\n' ${q(`#!/bin/bash\n${body}`)} > /fake/${name}`);
  }
  box.sh("chmod 755 /fake/*");
}, 600_000);
afterAll(() => box?.stop());

/** The machine as Legion found it: Ollama open to all, Mnemo's .env pointing anywhere. */
function reset(env = `MNEMO_API_KEY=${MARQUEUR}\nMNEMO_OLLAMA_URL=http://0.0.0.0:11434\n`) {
  box.sh(`rm -rf ${S}/mnemo-api.service.d ${S}/mnemo-mcp.service.d ${S}/ollama.service.d /root/projects \
    /tmp/appels* /tmp/tmp.* /tmp/ecoute-tailnet.conf /tmp/ollama-override.conf
    mkdir -p ${S}/ollama.service.d /root/projects/mnemo
    printf '[Service]\\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\\n' > ${S}/ollama.service.d/override.conf
    chmod 644 ${S}/ollama.service.d/override.conf; true`);
  if (env !== "")
    box.sh(
      `printf '%s' ${q(env)} > /root/projects/mnemo/.env && chmod 644 /root/projects/mnemo/.env`,
    );
}
const fermer = (env = "", args = "root@mnemo-exemple root@temoin-exemple") =>
  box.sh(
    `${env} PATH=/fake:$PATH MNEMO_ESSAIS=2 MNEMO_ATTENTE_OLLAMA=2 bash ${M}/fermer-au-reseau-local ${args}`,
  );
const cat = (path: string) => box.sh(`cat ${path} 2>/dev/null`).out;
const calls = (file: string) => cat(`/tmp/${file}`);
const filled = (address = "100.64.0.10") =>
  box.sh(`sed 's/@TAILNET@/${address}/g' ${M}/ecoute-tailnet.conf`).out;
const OLD_OLLAMA = '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\n';

/** Nothing posed, nothing restarted, the .env as it was, no leftovers. */
function untouched(env = `MNEMO_API_KEY=${MARQUEUR}\nMNEMO_OLLAMA_URL=http://0.0.0.0:11434\n`) {
  expect(box.sh(`ls ${S}/mnemo-api.service.d ${S}/mnemo-mcp.service.d 2>&1`).code).not.toBe(0);
  expect(cat(`${S}/ollama.service.d/override.conf`)).toBe(OLD_OLLAMA);
  expect(box.sh(`ls ${S}/ollama.service.d`).out.trim()).toBe("override.conf");
  if (env !== "") expect(cat("/root/projects/mnemo/.env")).toBe(env);
  expect(calls("appels")).toBe("");
  expect(box.sh("ls -d /tmp/tmp.* 2>/dev/null").out).toBe("");
}

describe.skipIf(!docker)("the files posed", () => {
  it("the template holds no address, and fills to Legion's four settings", () => {
    // 0.0.0.0, the default its comments explain, and no other address.
    const addresses = cat(`${M}/ecoute-tailnet.conf`).match(/\d+\.\d+\.\d+\.\d+/g);
    expect(new Set(addresses)).toEqual(new Set(["0.0.0.0"]));
    const settings = filled()
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(settings).toEqual([
      "[Unit]",
      "After=tailscaled.service",
      "Wants=tailscaled.service",
      "[Service]",
      "Environment=MNEMO_API_HOST=100.64.0.10",
      "Environment=MNEMO_MCP_HOST=100.64.0.10",
      "Environment=MNEMO_MCP_METRICS_HOST=100.64.0.10",
      "Environment=MNEMO_MCP_API_URL=http://100.64.0.10:8000",
      "RestartSec=5",
    ]);
  });

  it("Ollama's override: the loopback only, and Legion's thread count", () => {
    const settings = cat(`${M}/ollama-override.conf`)
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(settings).toEqual([
      "[Service]",
      'Environment="OLLAMA_HOST=127.0.0.1:11434"',
      'Environment="LLAMA_ARG_THREADS=5"',
    ]);
  });
});

describe.skipIf(!docker)("fermer-au-reseau-local, the nominal pose", () => {
  it("poses both overrides, rewrites one line of the .env, keeps copies, and proves it", () => {
    reset();
    const run = fermer();
    expect(run.err).toBe("");
    expect(run.code).toBe(0);
    expect(run.out).toContain("la machine de Mnemo est a 100.64.0.10");
    expect(run.out).toContain("son adresse sur le reseau local : 192.168.77.7");
    expect(run.out).toContain("les surcharges en place changent");
    expect(run.out).toContain("le MCP joint l'API");
    expect(run.out).toContain("Ferme.");
    for (const unit of ["mnemo-api", "mnemo-mcp"]) {
      expect(cat(`${S}/${unit}.service.d/ecoute-tailnet.conf`)).toBe(filled());
      expect(box.sh(`stat -c %a ${S}/${unit}.service.d/ecoute-tailnet.conf`).out.trim()).toBe(
        "644",
      );
    }
    expect(cat(`${S}/ollama.service.d/override.conf`)).toBe(cat(`${M}/ollama-override.conf`));
    expect(cat(`${S}/ollama.service.d/override.conf.bak-avant-*`)).toBe(OLD_OLLAMA);
    expect(cat("/root/projects/mnemo/.env")).toBe(
      `MNEMO_API_KEY=${MARQUEUR}\nMNEMO_OLLAMA_URL=http://127.0.0.1:11434\n`,
    );
    expect(
      box.sh("stat -c %a /root/projects/mnemo/.env /root/projects/mnemo/.env.bak-avant-*").out,
    ).toBe("600\n600\n");
    expect(calls("appels")).toBe(
      "systemctl daemon-reload\nsystemctl restart ollama.service\n" +
        "systemctl restart mnemo-api.service mnemo-mcp.service mnemo-watch.service\n",
    );
    expect(calls("appels-tcp")).toBe(
      ["22", "8000", "8001", "8002", "11434"].map((p) => `192.168.77.7/${p}\n`).join(""),
    );
    // Which machine each command reached: all on Mnemo's, but the witness's attempts.
    const ports = "'( sport = :8000 or sport = :8001 or sport = :8002 or sport = :11434 )'";
    expect(calls("appels-ssh").replace(/\/tmp\/tmp\.\w+/g, "<tmp>")).toBe(
      [
        "ssh root@mnemo-exemple tailscale ip -4",
        "ssh root@mnemo-exemple hostname -I",
        "ssh root@mnemo-exemple mktemp -d",
        "scp -q <tmp>/ecoute-tailnet.conf <tmp>/ollama-override.conf root@mnemo-exemple:<tmp>/",
        "ssh root@mnemo-exemple bash -s -- <tmp>",
        `ssh root@mnemo-exemple ss -lntH ${ports}`,
        "ssh root@temoin-exemple bash -s -- 192.168.77.7",
        "",
      ].join("\n"),
    );
    expect(box.sh("ls -d /tmp/tmp.* 2>/dev/null").out).toBe("");
  });

  it("a failed copy: nothing posed, and the directory made on the machine removed", () => {
    reset();
    const run = fermer("FAUX_SCP_PANNE=1");
    expect(run.code).toBe(1);
    expect(run.err).toContain("copie impossible");
    untouched();
  });

  it("never displays the .env, nor the answer of the MCP", () => {
    reset();
    const run = fermer(`FAUX_STATS=${q(`{"result":{"content":[{"text":"NOTE-PRIVEE"}]}}`)}`);
    expect(run.code).toBe(0);
    expect(run.out + run.err).not.toContain(MARQUEUR);
    expect(run.out + run.err).not.toContain("NOTE-PRIVEE");
  });

  it("replayable: the same settings, posed again, said to be the same", () => {
    reset();
    fermer();
    box.sh(`sed -i '1s/.*/# un commentaire change/' ${S}/mnemo-mcp.service.d/ecoute-tailnet.conf`);
    const again = fermer();
    expect(again.code).toBe(0);
    expect(again.out).toContain("memes surcharges que celles en place");
    expect(cat(`${S}/mnemo-mcp.service.d/ecoute-tailnet.conf`)).toBe(filled());
    expect(cat("/root/projects/mnemo/.env")).toContain("MNEMO_OLLAMA_URL=http://127.0.0.1:11434\n");
  });

  it("a setting changed by hand since is said to change", () => {
    reset();
    fermer();
    box.sh(`sed -i 's/RestartSec=5/RestartSec=1/' ${S}/mnemo-mcp.service.d/ecoute-tailnet.conf`);
    expect(fermer().out).toContain("les surcharges en place changent");
  });

  it("copies into a directory of its own: a file planted in /tmp is never read nor written", () => {
    reset();
    box.sh("ln -s /etc/shadow /tmp/ecoute-tailnet.conf; echo PIEGE > /tmp/ollama-override.conf");
    const shadow = cat("/etc/shadow");
    expect(fermer().code).toBe(0);
    expect(cat("/etc/shadow")).toBe(shadow);
    expect(cat(`${S}/ollama.service.d/override.conf`)).not.toContain("PIEGE");
    expect(cat(`${S}/mnemo-api.service.d/ecoute-tailnet.conf`)).toBe(filled());
  });
});

describe.skipIf(!docker)("refused before anything is posed", () => {
  it.each([
    "",
    "root@mnemo-exemple",
    "root@mnemo-exemple root@temoin-exemple de-trop",
    "debian@mnemo-exemple root@temoin-exemple",
    "root@mnemo-exemple temoin-sans-compte",
    "'root@mnemo;touch /tmp/pwned' root@temoin-exemple",
    "root@mnemo-exemple -oProxyCommand=touch",
  ])("arguments « %s »: usage, and no machine reached", (args) => {
    reset();
    const run = fermer("", args);
    expect(run.code).toBe(2);
    expect(run.err).toContain("usage");
    expect(calls("appels-ssh")).toBe("");
    expect(box.sh("ls /tmp/pwned 2>&1").code).not.toBe(0);
    untouched();
  });

  it("tailscale unreadable on the machine", () => {
    reset();
    const run = fermer("FAUX_TS_PANNE=1");
    expect(run.code).toBe(1);
    expect(run.err).toContain("tailscale illisible");
    untouched();
  });

  it.each([
    ["empty", ""],
    ["a local address", "192.168.77.7"],
    ["below the tailnet", "100.63.255.1"],
    ["above the tailnet", "100.128.0.1"],
    ["two addresses", "100.64.0.10\n100.64.0.11"],
    ["out of range", "100.64.0.256"],
    ["a command", "100.64.0.10;touch /tmp/pwned"],
    ["a sed separator", "100.64.0.10/g;s/x"],
  ])("tailscale answers %s: not an address of the tailnet", (_, answer) => {
    reset();
    const run = fermer(`FAUX_TAILNET=${q(answer)}`);
    expect(run.code).toBe(1);
    expect(run.err).toContain("pas une adresse du tailnet");
    expect(box.sh("ls /tmp/pwned 2>&1").code).not.toBe(0);
    untouched();
  });

  it.each([
    ["none on 192.168", "10.0.0.5 100.64.0.10"],
    ["a truncated one", "192.168.77 100.64.0.10"],
  ])("the machine has %s: the local proof would be impossible", (_, addresses) => {
    reset();
    const run = fermer(`FAUX_ADRESSES=${q(addresses)}`);
    expect(run.code).toBe(1);
    expect(run.err).toContain("aucune adresse 192.168.*");
    untouched();
  });

  it.each([
    ["without MNEMO_OLLAMA_URL", `MNEMO_API_KEY=${MARQUEUR}\nMNEMO_OLLAMA_URLX=1\n`],
    ["absent", ""],
  ])("the .env %s: nothing posed, its secret not displayed", (_, env) => {
    reset(env);
    const run = fermer();
    expect(run.code).toBe(1);
    expect(run.err).toContain("MNEMO_OLLAMA_URL absent");
    expect(run.out + run.err).not.toContain(MARQUEUR);
    untouched(env);
  });
});

describe.skipIf(!docker)("each failed proof stops the script, and says why", () => {
  it("Ollama silent on the loopback after its restart: Mnemo not restarted", () => {
    reset();
    const run = fermer("FAUX_OLLAMA_MUET=1");
    expect(run.code).toBe(1);
    expect(run.err).toContain("Ollama ne repond pas en local");
    expect(calls("appels")).not.toContain("mnemo-api");
  });

  it("a service still listening on every interface", () => {
    reset();
    const run = fermer(
      `FAUX_ECOUTE=${q("100.64.0.10:8000 0.0.0.0:8001 100.64.0.10:8002 127.0.0.1:11434")}`,
    );
    expect(run.code).toBe(1);
    expect(run.err).toContain("0.0.0.0:8001");
    expect(run.out).not.toContain("temoin");
  });

  it("the witness's port 22 silent: a refusal would prove nothing", () => {
    reset();
    const run = fermer("FAUX_OUVERTS=");
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("l'epreuve ne vaut rien");
    expect(run.out).not.toContain("par le tailnet");
  });

  it.each(["8000", "8001", "8002", "11434"])("port %s still open on the local network", (port) => {
    reset();
    const run = fermer(`FAUX_OUVERTS=${q(`22 ${port}`)}`);
    expect(run.code).not.toBe(0);
    expect(run.err).toContain(`le port ${port} repond encore`);
  });

  it.each([
    ["8000=500 8001=406 8002=200 11434=000", "l'API ne repond pas 200", "500"],
    ["8000=200 8001=000 8002=200 11434=000", "le MCP ne repond pas", "000"],
    ["8000=200 8001=406 8002=404 11434=000", "les metriques ne repondent pas", "404"],
  ])("by the tailnet, %s", (codes, message, last) => {
    reset();
    const run = fermer(`FAUX_CODES=${q(codes)}`);
    expect(run.code).toBe(1);
    expect(run.err).toContain(message);
    expect(run.err).toContain(`dernier code : ${last}`);
  });

  it("Ollama still answering on the tailnet", () => {
    reset();
    const run = fermer(`FAUX_CODES=${q("8000=200 8001=406 8002=200 11434=200")}`);
    expect(run.code).toBe(1);
    expect(run.err).toContain("Ollama repond encore sur le tailnet");
  });

  it("the MCP opens no session", () => {
    reset();
    const run = fermer("FAUX_SANS_SESSION=1");
    expect(run.code).toBe(1);
    expect(run.err).toContain("pas ouvert de session");
  });

  it.each([
    ['{"result":{"isError": true}}', "rend une erreur"],
    ['{"result":{"isError" : true}}', "rend une erreur"],
    ["<html>proxy</html>", "reponse illisible"],
    ["", "reponse illisible"],
  ])("« stats » answers %s", (answer, message) => {
    reset();
    const run = fermer(`FAUX_STATS=${q(answer)}`);
    expect(run.code).toBe(1);
    expect(run.err).toContain(message);
  });
});
