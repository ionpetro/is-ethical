// PostHog. Browser: /analytics.js loads the snippet when POSTHOG_KEY is set (empty script otherwise, e.g. local dev).
// Server: agent activity (API and MCP) is captured here, because agents never run the page's JavaScript.
// Never send text people or agents typed: no titles, bodies, comments, reasons or names.

const KEY = () => process.env.POSTHOG_KEY || "";
const HOST = () => (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
const APP = "is-ethical";

export function analyticsScript() {
  const key = KEY();
  if (!/^phc_[A-Za-z0-9_-]+$/.test(key)) return "/* analytics off */\n";
  return `!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags identify setPersonProperties group resetGroups reset get_distinct_id get_session_id alias set_config startSessionRecording stopSessionRecording captureException opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init(${JSON.stringify(key)},{api_host:${JSON.stringify(HOST())},defaults:"2025-05-24",person_profiles:"identified_only",session_recording:{maskAllInputs:true,maskTextSelector:".text,.qfull,.qbody,.reason p"}});
posthog.register({app:${JSON.stringify(APP)},surface:"web"});
`;
}

/**
 * Capture one server-side event. Waits at most ~1.5 s so serverless functions don't drop it, and never throws.
 * @param {string} distinctId hashed voter id (never the raw key)
 * @param {string} event
 * @param {Record<string, unknown>} props
 */
export async function capture(distinctId, event, props = {}) {
  const key = KEY();
  if (!key) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    await fetch(`${HOST()}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key, event, distinct_id: distinctId,
        properties: { app: APP, $process_person_profile: false, ...props },
      }),
      signal: ctrl.signal,
    });
  } catch { /* analytics must never break the API */ } finally { clearTimeout(t); }
}
