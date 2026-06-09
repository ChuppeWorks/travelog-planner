import assert from "node:assert/strict";
import test from "node:test";
import { LANGUAGE_OPTIONS, isRtlLanguage, resolveLanguage, translate } from "../apps/obsidian-plugin/src/i18n";

test("automatic language follows supported system languages and falls back to English", () => {
  assert.equal(resolveLanguage("auto", "ko-KR"), "ko");
  assert.equal(resolveLanguage("auto", "ja-JP"), "ja");
  assert.equal(resolveLanguage("auto", "fr-FR"), "fr");
  assert.equal(resolveLanguage("auto", "zh-HK"), "zh-TW");
  assert.equal(resolveLanguage("auto", "pt-PT"), "pt-BR");
  assert.equal(resolveLanguage("auto", "sv-SE"), "en");
  assert.equal(resolveLanguage("en", "ko-KR"), "en");
  assert.equal(isRtlLanguage("ar"), true);
  assert.equal(isRtlLanguage("auto", "ar-SA"), true);
});

test("translations interpolate values in each supported language", () => {
  assert.equal(translate("en", "summary.counts", { points: 2, routes: 1, planned: "" }), "2 points · 1 routes");
  assert.equal(translate("ko", "item.delay", { minutes: 15 }), "지연: 15분");
  assert.equal(translate("ja", "upsell.context", { from: "東京", to: "京都" }), "経路: 東京 → 京都");
});

test("every selectable non-English language localizes the Travelog map conversion action", () => {
  assert.equal(LANGUAGE_OPTIONS.length, 21);
  const english = translate("en", "button.viewMap");
  const englishOpens = translate("en", "field.opens");
  for (const { value } of LANGUAGE_OPTIONS) {
    if (value === "auto" || value === "en") continue;
    assert.notEqual(translate(value, "button.viewMap"), english, value);
    assert.notEqual(translate(value, "field.opens"), englishOpens, value);
  }
});
