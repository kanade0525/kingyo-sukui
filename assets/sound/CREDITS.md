# 音源の出どころ

ポンプ・祭囃子・ざわめき・虫・水音は、その場で合成しています
（`assets/js/sound.js`）。実際の録音を使っているのは下の 4 つです。

## ライセンス

この 4 本は、**ファイルそのものの再配布が許された素材**であることを
利用者（リポジトリの持ち主）が確認したうえで置いています。

- `semi-hiru.m4a` … 昼の蝉
- `semi-yugata.m4a` … 夕方の蝉
- `furin.m4a` … 風鈴
- `ame.m4a` … 雨

元ファイルに残っていた手掛かりは、風鈴の 1 本だけです。
録音機は Sony PCM-D100、ファイル名は `220703_046`（2022 年 7 月 3 日の
46 本目と読める）。現地録音されたものと見られます。
残る 3 本にはタグがありませんでした。

素材の配布元が分かったら、ここに名前と URL を足してください。

## 加工の内容

元は 44.1〜48kHz・192kbps の mp3。次の処理だけをしています。

- 使う部分を切り出し（雨・蝉は 20 秒、風鈴は 30 秒）
- 末尾 2 秒を先頭に重ねて輪にする。繋ぎ目の段差を測り、
  曲中のいちばん大きな段差より小さいことを確認済み
- 音量を -20 LUFS に揃える（層ごとの音量を同じ物差しで決めるため）
- AAC 112kbps・44.1kHz・ステレオへ変換

形式が m4a なのは、ogg vorbis を iOS の Safari が読めないためです。
以前は ogg で置いていたので、iPhone では読み込みに失敗して
黙って合成音に落ちていました。

## 測った内容

耳で判断できないので、測った値を残しておきます。

- `semi-hiru.m4a` … いちばん強いのは 5.4〜6.2kHz、脈は毎秒 7.5 回
- `semi-yugata.m4a` … いちばん強いのは 4.6kHz、脈はそれより速い
- `ame.m4a` … 1.5〜2.2kHz を中心に広く、脈なし（降り続く雨）
- `furin.m4a` … いちばん強いのは 3.8〜4.6kHz

種類の名前は、音から断定できないので書いていません。

## 置き換えた録音

以前は Wikimedia Commons の CC0 録音を使っていましたが、
どちらも種類が違ったので外しました。

- `semi.ogg` … [Chorus Cicada singing](https://commons.wikimedia.org/wiki/File:Chorus_Cicada_singing.ogg)
  （CC0 / Siobhan Lea）。ニュージーランドのセミの合唱
- `furin.ogg` … [Windglockenspiel.Koshi](https://commons.wikimedia.org/wiki/File:Windglockenspiel.Koshi.ogg)
  （CC0 / Membeth）。西洋の音階付き風鈴

この 2 本はまだ残してありますが、どこからも読んでいません。

## 使えなかった素材サイト

効果音ラボ・Pixabay はどちらも商用無料・クレジット不要ですが、
**音声ファイルそのものの再配布を禁止**しています。
公開リポジトリに置くと単体で取得できる状態になるため、使えません。

- 効果音ラボ … 「再配布禁止」「効果音ファイルへの直リンク禁止」
- Pixabay … "You cannot sell or distribute Content ... on a Standalone basis"
