import { A, useLocation, useNavigate } from "@solidjs/router";
import { Icon } from "./icons";
import { createEffect, Show } from "solid-js";
import { createSignal } from "solid-js";

export const mds = " · ";

// Affichage d'une promo : « P26 » pour les promos numériques, sinon le code en
// majuscules (« AST19 », « ISUP15 »), jamais « Past19 ».
export function promoLabel(promo) {
  if (!promo) return "";
  return /^\d+$/.test(String(promo)) ? `P${promo}` : String(promo).toUpperCase();
}

export const dateForDateTimeInputValue = date => new Date(date.getTime() + new Date().getTimezoneOffset() * -60 * 1000).toISOString().slice(0, 19)

export function timeAgo(date) {
  if (typeof date == 'object') date = new Date(date);
  const seconds = Math.floor((new Date() - date) / 1000);

  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1
  };

  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return interval === 1 ? `${interval} ${unit} ago` : `${interval} ${unit}s ago`;
    }
  }

  return 'just now';
}

export function is2xx(res) {
  return Math.floor(res.status / 100) == 2;
}


export function Link(props) {
  const location = useLocation();
  return <A state={{ previous: location.pathname }} {...props} />;
}

export function BackButton(props) {
  const navigate = useNavigate();
  const location = useLocation();
  const backPath = () => (location.state?.previous || '/');
  return <button class="uppercase flex flex-row gap-1 items-center cursor-pointer text-base" onClick={() => navigate(backPath())}>
    <Show when={props.children} fallback={<><Icon type="arrow-left" size={1}/><span class="pt-[0.8]">retour</span></>}>
      {props.children}
    </Show>
  </button>;
}

export function LinkButton(props) {
  const classes = "w-fit font-bold cursor-pointer text-vf";
  const text = props.text || props.children || 'here'
  if (props.href) {
    return <Link href={props.href} class={classes}>{text}</Link>
  }
  if (props.onclick || props.onClick) {
    return <span onclick={(props.onclick || props.onClick)} class={classes}>{text}</span>
  }
}

export function LinkIcon(props) {
  return (
    <Link {...props} class="flex flex-row items-center gap-1 font-bold"><Icon type={props.type}/>{props.text}</Link>
  )
}
