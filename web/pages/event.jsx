import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import { User } from "../components/user"

import { RosterSearch } from "../components/rostersearch";
import { isAdmin } from "../res/admin";
import { BackButton, LinkButton } from "../components/utils";
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

              <div class="flex flex-col gap-1">
                <span class="font-semibold">Mineurs déjà inscrits :</span>
                <div>
                  <Show when={ev().users.length === 0}>
                    <span class="text-sm text-gray-600">Aucun mineur inscrit pour le moment.</span>
                  </Show>
                  <For each={ev().users}>
                    {(user, i) => (
                      <Show when={i() < ev().participants} fallback={<User user={user} state={0}/>}>
                        <User user={user} state={1}/>
                      </Show>
                    )}
                  </For>
                </div>
              </div>

              <Show when={!ev().closed} fallback={<h3 class="text-xl font-bold mt-4 mb-2">PAPS fermé</h3>}>
                <h3 class="text-xl font-bold mt-4 mb-2">équi-PAPS</h3>
                N'hésite pas à t'inscrire même s'il ne reste plus de place, il y a souvent des désistements.<br/>
                <span><b>Règles :</b> pendant les 24 premières heures, priorité au moins servi (nombre de sorties croissant), puis au cotisant à égalité, puis à l'ordre d'inscription. Après 24 h, premier arrivé premier servi.</span>
                <Show
                  when={new Date(new Date(ev().paps).getTime() + 24 * 60 * 60 * 1000) > new Date()}
                  fallback={<div class="text-sm text-gray-600 mt-1">Phase « vrai PAPS » : premier arrivé, premier servi.</div>}
                >
                  <div class="text-sm text-gray-600 mt-1">Fenêtre prioritaire (24&nbsp;h en cours) : le tirage favorise le moins servi.</div>
                </Show>
                <form onSubmit={handleSubmit} class="mt-2 flex flex-col gap-3">
                  <RosterSearch
                    onSelect={r => { setSelected(r); setStatus(""); }}
                    onInput={() => setSelected(null)}
                    placeholder="Ton nom (comme sur le portail)"
                  />
                  <Show when={selected()}>
                    <div class="text-sm text-gray-700">
                      Inscription de <b>{selected().prenom} {selected().nom}</b> (P{selected().promo} · {selected().pxx})
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