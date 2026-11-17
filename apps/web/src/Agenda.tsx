/**
 * The Agenda tab (ADR-0042, point 6): the appointments day by day, with their
 * titles — written by others, shown as plain text (React escapes it); an
 * account down named with what went wrong, the others shown; the appointments
 * set aside, counted with their reason. Read when the tab opens, then every 15
 * minutes while it stays open; nothing kept in the page beyond the last view.
 */
import { useCallback, useEffect, useState } from "react";
import { daysOf, FAILURE_LABEL, hoursOf, REASON_LABEL } from "./agenda-rules.ts";
import { type AgendaView, ApiError, getAgenda } from "./api.ts";
import { forgetToken } from "./token.ts";

const REFRESH_MS = 15 * 60_000;

/** One reading, shown: no call of its own (the preview shows it with fictitious data). */
export function AgendaPanel({ view }: { readonly view: AgendaView }) {
  if (view.read === "absent") {
    return (
      <p className="bloc verrou">
        Aucun agenda déclaré : les comptes se déclarent dans <code>agenda.local.toml</code> (voir{" "}
        <code>agenda.local.example.toml</code>), leurs mots de passe dans <code>.env.agenda</code>.
      </p>
    );
  }
  if (view.read === "config") {
    return <p className="bloc verrou">agenda.local.toml est à revoir : {view.why}.</p>;
  }
  const down = view.accounts.flatMap((a) => (a.state === "ok" ? [] : [{ ...a, state: a.state }]));
  const several = view.accounts.length > 1;
  return (
    <section className="agenda" aria-label="L'agenda">
      {down.length > 0 && (
        <ul className="bloc agenda-pannes" aria-label="Agendas non lus">
          {down.map((a) => (
            <li key={a.name}>
              Agenda <strong>{a.name}</strong> non lu : {FAILURE_LABEL[a.state]}
            </li>
          ))}
        </ul>
      )}
      {view.setAside.length > 0 && (
        <ul className="bloc agenda-ecartes" aria-label="Rendez-vous écartés">
          {view.setAside.map((s) => (
            <li key={`${s.account}-${s.reason}`}>
              {s.count} rendez-vous écarté{s.count > 1 ? "s" : ""}
              {several ? ` (${s.account})` : ""} : {REASON_LABEL[s.reason]}
            </li>
          ))}
        </ul>
      )}
      {daysOf(view.from, view.days, view.events).map((d) => (
        <article key={d.day} className="bloc agenda-jour">
          <h2>{d.label}</h2>
          {d.allDay.length + d.timed.length === 0 ? (
            <p className="agenda-vide">Rien.</p>
          ) : (
            <ul className="agenda-liste">
              {d.allDay.map((e, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: no identifier is kept (ADR-0042); the rows hold no state
                <li key={`j${i}`} className="agenda-rdv">
                  <span className="agenda-heure">journée</span>
                  <span className="agenda-titre">{e.title === "" ? "(sans titre)" : e.title}</span>
                  {several && <span className="agenda-compte">{e.account}</span>}
                </li>
              ))}
              {d.timed.map((e, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: no identifier is kept (ADR-0042); the rows hold no state
                <li key={`h${i}`} className="agenda-rdv">
                  <span className="agenda-heure">{hoursOf(e)}</span>
                  <span className="agenda-titre">{e.title === "" ? "(sans titre)" : e.title}</span>
                  {several && <span className="agenda-compte">{e.account}</span>}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}

export function Agenda({ token, onLost }: { readonly token: string; readonly onLost: () => void }) {
  const [view, setView] = useState<AgendaView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setView(await getAgenda(token));
      setMessage(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        forgetToken();
        onLost();
        return;
      }
      setMessage(
        error instanceof ApiError
          ? `L'agenda n'a pas pu être lu : ${error.message}`
          : "L'agenda n'a pas pu être lu.",
      );
    }
  }, [token, onLost]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (view === null) return <p className="bloc verrou">{message ?? "Lecture de l'agenda…"}</p>;
  return (
    <>
      {message !== null && <p className="message">{message}</p>}
      <AgendaPanel view={view} />
    </>
  );
}
