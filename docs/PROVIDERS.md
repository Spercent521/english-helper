# Providers and Privacy

## Requests

The typed word is sent to Free Dictionary API only when it is not already in the
local database. If that provider fails, the word is sent to the public Youdao
dictionary endpoint. Audio playback always sends the selected word and accent
to the public Youdao pronunciation endpoint.

No analytics, telemetry, user accounts, microphone access, or background
requests are implemented. An existing word's text is read from SQLite without
requesting dictionary data. Source URLs, pronunciation metadata, definitions,
examples and creation timestamps are stored locally.

Audio is fetched by Go's HTTP client, which does not implement a persistent HTTP
cache. A `Cache-Control: no-store` request header is sent. Audio is passed through
the local application bridge into Web Audio as transient memory data, decoded,
played and released. It is never intentionally written to a database or file.
This does not control operating-system swap or the provider's own server logs.

## Availability

Free Dictionary API is public and requires no API key:

https://dictionaryapi.dev/

Youdao's web endpoints used by this prototype:

https://dict.youdao.com/jsonapi?q=hello

https://dict.youdao.com/dictvoice?audio=hello&type=1

https://dict.youdao.com/dictvoice?audio=hello&type=2

These Youdao endpoints are publicly accessible web-service endpoints, not a
contracted API with guaranteed stability or redistribution permission.
No authentication, payment, CAPTCHA or encryption is bypassed.
The dictionary fallback consumes only plain returned dictionary fields and
ignores encrypted sections.

A successful HTTP response is not evidence of a license. The implementation
retains provider/source attribution but that alone does not grant permission.
Public or commercial distribution requires reviewing each provider's current
terms and securing any necessary permissions. The prototype makes no claim
that these services or returned content have been cleared for redistribution.
Do not market it as an officially integrated Oxford, Cambridge or Google app.

Recordings may be synthesized or recorded depending on the provider; this app
does not claim they are always human recordings. Playback always requires
network access. Requests may fail due to region, outages or endpoint changes,
and the app displays errors rather than silently switching to system TTS.
