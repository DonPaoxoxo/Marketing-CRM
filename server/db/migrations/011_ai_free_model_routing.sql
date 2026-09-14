-- AI Assistant Learner: route across the 20 free OpenRouter models (3 main + 17 fallback).
--
--   * models grows to TEXT: twenty model ids no longer fit in VARCHAR(1000).
--   * total_timeout_ms caps one whole request across every model and retry. The
--     default 55 s stays under nginx's default 60 s proxy timeout, so members get
--     the app's own clear message rather than a gateway error.
--   * The model list and per-attempt timeout are only replaced where they are still
--     the untouched defaults from migration 010; a list the System Owner already
--     changed is kept.

ALTER TABLE ai_settings
  MODIFY COLUMN models TEXT NOT NULL,
  ADD COLUMN total_timeout_ms INT UNSIGNED NOT NULL DEFAULT 55000 AFTER timeout_ms;

UPDATE ai_settings
   SET models = '[{"id":"google/gemma-4-31b-it:free","enabled":true},{"id":"nvidia/nemotron-3-super-120b-a12b:free","enabled":true},{"id":"google/gemma-4-26b-a4b-it:free","enabled":true},{"id":"nex-agi/nex-n2.5-pro:free","enabled":true},{"id":"nex-agi/nex-n2.5-mini:free","enabled":true},{"id":"dots-studio/dots-3-note-preview:free","enabled":true},{"id":"liquid/lfm-2.5-2.6b:free","enabled":true},{"id":"openrouter/free","enabled":true},{"id":"nvidia/nemotron-3-ultra-550b-a55b:free","enabled":true},{"id":"nvidia/nemotron-3.5-lightning:free","enabled":true},{"id":"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","enabled":true},{"id":"nvidia/nemotron-3.5-content-safety:free","enabled":true},{"id":"thinkingmachines/inkling:free","enabled":true},{"id":"thinkingmachines/inkling-small:free","enabled":true},{"id":"poolside/laguna-s-2.1:free","enabled":true},{"id":"poolside/laguna-xs-2.1:free","enabled":true},{"id":"inclusionai/ling-3.0-flash-vl:free","enabled":true},{"id":"inclusionai/ling-3.0-flash-fin:free","enabled":true},{"id":"inclusionai/ling-3.0-flash-sante:free","enabled":true},{"id":"cohere/north-mini-code:free","enabled":true}]'
 WHERE id = 1
   AND models = '[{"id":"qwen/qwen3-32b:free","enabled":true},{"id":"google/gemma-3-27b-it:free","enabled":true},{"id":"meta-llama/llama-3.3-70b-instruct:free","enabled":true}]';

UPDATE ai_settings SET timeout_ms = 20000 WHERE id = 1 AND timeout_ms = 30000;
