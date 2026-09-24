import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";

import { RosterSearch } from "../components/rostersearch";
import { isAdmin } from "../res/admin";
import { BackButton, LinkButton, promoLabel } from "../components/utils";
import { Icon } from "../components/icons";


export const [ token, setToken ] = createSignal(localStorage.getItem("token"));
createEffect(() => {
  localStorage.setItem("token", token());
})

export async function fetchEvent(id) {
  const headers = {};
  if (token()) headers.authorization = token();
  const res = await fetch(`/api/event/${id}`, { headers });
  if (!res.ok) throw new Error("Événement introuvable");
  const json = await res.json();
  if (json.token) setToken(json.token);
  return json;
}

export default function EventPage() {
  const params = useParams();
  const [ev, { mutate, refetch }] = createResource(params.id, fetchEvent);
  const [selected, setSelected] = createSignal(null);
  const [status, setStatus] = createSignal("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!selected()) {
        setStatus("Choisis ton nom dans la liste.");
        return;
      }
      var res = await (await fetch("/api/paps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": token(),
        },
        body: JSON.stringify({
          eid: params.id,
          pxx: selected().pxx,
        }),
      })).json();
      if (res.success === false) {
        setStatus(res.message || "Erreur lors de l'enregistrement. Merci de réessayer.");
        return;
      } else {
        setStatus("Ta demande a bien été enregistrée ! Tu seras notifié dans les heures qui suivent :)");
        refetch();
      }
    } catch (err) {
      setStatus("Erreur lors de l'enregistrement.");
    }
  };

  return (
    <Layout floating={true}>
      <MetaProvider>
        <Title>{ev()?.name ? `Événement - ${ev().name}` : "Événement"}</Title>
      </MetaProvider>
      <div class="flex flex-col w-full">
        <BackButton/>
        {ev.loading && <div>Chargement...</div>}
        {ev.error && <div>Erreur : {ev.error.message}</div>}
        {ev() && (
          <>
            <div class="mb-2">
              <h2 class="text-2xl font-bold">{ev().name}</h2>
              <Show when={isAdmin()}>
                <LinkButton href={"/editevent/" + ev().id}>Modifier l'événement</LinkButton>
              </Show>
            </div>
            <div class="mb-2 text-gray-700 flex flex-row items-center gap-1">
              <Icon type="calendar-week" size={1}/>
              {new Date(ev().date).toLocaleString()}
            </div>
            <div class="mb-2 text-gray-700 flex flex-row items-center gap-1">
              <Icon type="location-dot" size={1}/>
              {ev().location}
            </div>
            <div class="mb-2 text-gray-700">
              <span class="font-semibold">Participants (hors accompagnants) :</span> {ev().participants}
            </div>
            <Show when={ev().description}>
              <div class="mb-2 text-gray-700">
                <div>{ev().description}</div>
              </div>
            </Show>
            
            <Show 
              when={new Date(ev().paps) < new Date()}
              fallback={<div class=" p-4 bg-yellow-100 border border-yellow-300 rounded">Ouverture de l'équi-PAPS le <b>{new Date(ev().paps).toLocaleString()}</b>
              </div>}>

              <div class="mb-2 p-2 rounded bg-black/5 text-sm text-gray-700">
                <Show
                  when={new Date(new Date(ev().paps).getTime() + 24 * 60 * 60 * 1000) > new Date()}
                  fallback={<div><b>Vrai PAPS</b> — premier arrivé, premier servi.</div>}
                >
                  <div><b>Fenêtre prioritaire (24&nbsp;h)</b> — le tirage favorise le moins servi.</div>
                </Show>
                <div class="text-xs text-gray-600 mt-0.5">
                  Ordre de priorité : moins de sorties d'abord, puis le cotisant à égalité, puis l'ordre d'inscription. Passé 24&nbsp;h, premier arrivé premier servi.
                </div>
              </div>

              <div class="flex flex-col gap-1">
                <div class="flex items-baseline justify-between">
                  <h3 class="font-semibold text-base m-0">Inscrits</h3>
                  <span class="text-sm text-gray-600">
                    {Math.min(ev().users.length, ev().participants)}/{ev().participants} place{ev().participants > 1 ? 's' : ''} · {ev().users.length} inscrit{ev().users.length > 1 ? 's' : ''}
                  </span>
                </div>
                <Show when={ev().users.length === 0}>
                  <span class="text-sm text-gray-600">Personne d'inscrit pour le moment, sois le premier !</span>
                </Show>
                <div class="flex flex-col gap-1" role="list">
                  <For each={ev().users}>
                    {(user, i) => {
                      const retenu = i() < ev().participants;
                      const nom = (user.prenom || user.nom) ? `${user.prenom || ''} ${user.nom || ''}`.trim() : user.pxx;
                      return (
                        <>
                          <Show when={i() === ev().participants}>
                            <div class="flex items-center gap-2 my-1 text-xs text-gray-500">
                              <div class="flex-grow border-t border-gray-300"/>
                              limite des {ev().participants} place{ev().participants > 1 ? 's' : ''} · liste d'attente ci-dessous
                              <div class="flex-grow border-t border-gray-300"/>
                            </div>
                          </Show>
                          <div role="listitem" classList={{
                            'flex items-center gap-2 rounded px-2 py-1': true,
                            'bg-vc/25': retenu,
                            'bg-black/5': !retenu,
                          }}>
                            <span class="text-xs text-gray-500 w-5 text-right shrink-0">{i() + 1}</span>
                            <div class="flex flex-col flex-grow min-w-0">
                              <span class="font-semibold text-sm truncate">
                                {nom}
                                <Show when={user.promo}><span class="text-xs text-gray-500 font-normal"> · {promoLabel(user.promo)}</span></Show>
                              </span>
                              <span class="text-xs text-gray-500">
                                <Show when={user.cotisant}><span class="text-vf font-semibold">cotisant</span> · </Show>
                                {user.sortiesEffectuees} sortie{user.sortiesEffectuees > 1 ? 's' : ''} obtenue{user.sortiesEffectuees > 1 ? 's' : ''}
                              </span>
                            </div>
                            <Show when={retenu} fallback={<span class="text-xs text-gray-500 shrink-0">en attente</span>}>
                              <span class="text-xs font-bold text-vf shrink-0">✓ retenu</span>
                            </Show>
                          </div>
                        </>
                      );
                    }}
                  </For>
                </div>
              </div>

              <Show when={!ev().closed} fallback={<h3 class="text-xl font-bold mt-4 mb-2">PAPS fermé</h3>}>
                <h3 class="text-xl font-bold mt-4 mb-2">S'inscrire</h3>
                N'hésite pas à t'inscrire même s'il ne reste plus de place, il y a souvent des désistements.<br/>
                <form onSubmit={handleSubmit} class="mt-2 flex flex-col gap-3">
                  <RosterSearch
                    onSelect={r => { setSelected(r); setStatus(""); }}
                    onInput={() => setSelected(null)}
                    placeholder="Ton nom (comme sur le portail)"
                  />
                  <Show when={selected()}>
                    <div class="text-sm text-gray-700">
                      Inscription de <b>{selected().prenom} {selected().nom}</b> ({promoLabel(selected().promo)} · {selected().pxx})
                    </div>
                  </Show>
                  <button type="submit" disabled={!selected()} class="bg-vf text-white rounded p-2 font-bold disabled:opacity-50">PAPS</button>
                </form>
              </Show>
            </Show>
            {status() && <div class="mt-2 text-center">{status()}</div>}
          </>
        )}
      </div>
    </Layout>
  );
}