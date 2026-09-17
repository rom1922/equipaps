import { Match, Switch } from "solid-js";
import { Link } from "./utils";

export function Layout(props) {
  return (
    <>
      <div class="flex-grow overflow-y-scroll flex flex-col bg-d bg-[radial-gradient(#0006_1px,transparent_1px)] [background-size:16px_16px] bg-fixed">
        <Switch>
          <Match when={props.floating}>
            <div class="flex-grow flex flex-col items-center justify-center">
              <div style={{'max-width': '100%'}} class="p-4 flex w-100 bg-rtc rounded-md drop-shadow-[0_0px_10px_rgba(0,0,0,0.15)]">
                {props.children}
              </div>
            </div>
          </Match>
          <Match when={true}>
            <div class={"bg-d p-4 flex flex-col gap-2 flex-grow sm:mx-16 md:mx-32 lg:mx-48 xl:mx-64 2xl:mx-80" + (props.center ? ' justify-center' : '')}>
              {props.children}
            </div>
          </Match>
        </Switch>
      </div>
      <footer class="footer sm:footer-horizontal bg-b text-d flex justify-center flex-wrap [&>*]:px-4 [&>*]:py-0.5">
        <Link href="/">Accueil</Link>
        <Link href="/admin">Bureau</Link>
        <a href="mailto:bureaudesarts.minesparis@gmail.com">Contact</a>
        {/* Instagram : compte du mandat courant. SEULE valeur a changer a la passation d'un bureau a l'autre. */}
        <a href="https://www.instagram.com/art_lequin_bda_p25/" target="_blank">Instagram</a>
        <Link href="https://github.com/rom1922/equipaps" target="_blank">GitHub</Link>
      </footer>
    </>
  )
}