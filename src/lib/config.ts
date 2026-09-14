/** Build-time switches.
 *
 *  These gate the affordances that only make sense while the workspace runs on a
 *  mock API with no server behind it. Set them in `.env` / `.env.production`.
 *  Vite inlines `import.meta.env.*` at build time, so a disabled feature is not
 *  merely hidden — the branch is statically false. */

/** Serve the API from MSW in the browser instead of talking to the real one.
 *
 *  Opt-in, now that a real API exists: the workspace talks to `/api` unless this
 *  is explicitly turned on. It was the other way round while the server was the
 *  thing that did not exist yet, and leaving the default there would mean a
 *  missing `.env` quietly served a fake register that looks exactly like the
 *  real one and loses everything typed into it on reload.
 *
 *  Written as a bare comparison rather than via a helper on purpose: Vite
 *  replaces `import.meta.env.VITE_USE_MOCK_API` with a string literal at build
 *  time, so this folds to a constant and the bundler can drop the mock entirely.
 *  Routing it through a function call would defeat that and ship MSW to
 *  production. */
export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === 'true';

export const CONFIG = {
  useMockApi: USE_MOCK_API,

  /** The synthetic role switcher in the header. A preview device for looking at
   *  the workspace through another role's eyes while there is no real session —
   *  never a security control, and meaningless once one exists, because the role
   *  then comes from the session row and the switcher cannot change it. */
  enableRolePreview: USE_MOCK_API && import.meta.env.VITE_ENABLE_ROLE_PREVIEW !== 'false',
} as const;

/** Nothing is stored anywhere durable while the mock API is serving: the database
 *  lives in the browser tab and a reload empties it. The UI has to say so, loudly,
 *  because people are otherwise going to type a real register in and lose it. */
export const DATA_IS_EPHEMERAL = CONFIG.useMockApi;
