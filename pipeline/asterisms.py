"""Hand-curated classic constellation stick figures (western tradition).

License-clean: authored for this project from common knowledge of the
traditional figures (the shapes themselves are ancient); no third-party
line dataset is embedded. Endpoints are (constellation, Bayer) pairs and
are resolved against AT-HYG's own `con` and `bayer` columns at build time —
an endpoint that fails to resolve, or resolves to a star dimmer than the
sanity limit, drops its line with a warning rather than drawing nonsense.

Line = (con_a, bayer_a, con_b, bayer_b). Bayer letters use AT-HYG's
3-letter Greek abbreviations; superscripted entries (e.g. "Zet2") are
matched by prefix, taking the brightest candidate.
"""

CONSTELLATION_NAMES = {
    "And": "Andromeda", "Aql": "Aquila", "Aur": "Auriga", "Boo": "Boötes",
    "CMa": "Canis Major", "CMi": "Canis Minor", "Cas": "Cassiopeia",
    "Cen": "Centaurus", "Cep": "Cepheus", "CrB": "Corona Borealis",
    "Cru": "Crux", "Cyg": "Cygnus", "Gem": "Gemini", "Leo": "Leo",
    "Lyr": "Lyra", "Ori": "Orion", "Peg": "Pegasus", "Per": "Perseus",
    "Sco": "Scorpius", "Sgr": "Sagittarius", "Tau": "Taurus",
    "UMa": "Ursa Major", "UMi": "Ursa Minor",
}

MAX_LINE_MAG = 6.0  # endpoints dimmer than this are curation errors

def _chain(con, *bayers):
    return [(con, a, con, b) for a, b in zip(bayers, bayers[1:])]

LINES = [
    # Orion — hourglass, belt, head
    *_chain("Ori", "Alp", "Gam", "Del", "Bet", "Kap", "Zet", "Alp"),
    ("Ori", "Del", "Ori", "Eps"), ("Ori", "Eps", "Ori", "Zet"),
    ("Ori", "Gam", "Ori", "Lam"), ("Ori", "Lam", "Ori", "Alp"),
    # Ursa Major — Big Dipper bowl + handle
    *_chain("UMa", "Alp", "Bet", "Gam", "Del", "Alp"),
    *_chain("UMa", "Del", "Eps", "Zet", "Eta"),
    # Ursa Minor — Little Dipper
    *_chain("UMi", "Alp", "Del", "Eps", "Zet", "Bet", "Gam", "Eta", "Zet"),
    # Cassiopeia — the W
    *_chain("Cas", "Bet", "Alp", "Gam", "Del", "Eps"),
    # Cygnus — Northern Cross
    *_chain("Cyg", "Alp", "Gam", "Bet"),
    ("Cyg", "Gam", "Cyg", "Eps"), ("Cyg", "Gam", "Cyg", "Del"),
    # Lyra — Vega + parallelogram
    ("Lyr", "Alp", "Lyr", "Zet"),
    *_chain("Lyr", "Zet", "Bet", "Gam", "Del", "Zet"),
    # Aquila
    ("Aql", "Alp", "Aql", "Bet"), ("Aql", "Alp", "Aql", "Gam"),
    ("Aql", "Gam", "Aql", "Del"),
    # Scorpius — head, heart, tail hook
    *_chain("Sco", "Bet", "Del", "Sig", "Alp", "Tau", "Eps", "Mu", "Zet",
            "Eta", "The", "Iot", "Kap", "Lam"),
    ("Sco", "Del", "Sco", "Pi"),
    # Sagittarius — teapot
    *_chain("Sgr", "Gam", "Del", "Eps", "Zet", "Phi", "Lam", "Del"),
    ("Sgr", "Phi", "Sgr", "Sig"), ("Sgr", "Sig", "Sgr", "Tau"),
    ("Sgr", "Tau", "Sgr", "Zet"),
    # Taurus — V + horns
    *_chain("Tau", "Gam", "Del", "Eps", "Bet"),
    ("Tau", "Gam", "Tau", "Alp"), ("Tau", "Alp", "Tau", "Zet"),
    # Gemini — the twins
    *_chain("Gem", "Bet", "Del", "Zet", "Gam"),
    *_chain("Gem", "Alp", "Eps", "Mu", "Eta"),
    ("Gem", "Alp", "Gem", "Bet"),
    # Leo — sickle + body
    *_chain("Leo", "Eps", "Mu", "Zet", "Gam", "Eta", "Alp"),
    ("Leo", "Gam", "Leo", "Del"), ("Leo", "Del", "Leo", "Bet"),
    ("Leo", "Bet", "Leo", "The"), ("Leo", "The", "Leo", "Alp"),
    # Canis Major
    ("CMa", "Alp", "CMa", "Bet"), ("CMa", "Alp", "CMa", "Del"),
    ("CMa", "Del", "CMa", "Eps"), ("CMa", "Del", "CMa", "Eta"),
    # Canis Minor
    ("CMi", "Alp", "CMi", "Bet"),
    # Crux — Southern Cross
    ("Cru", "Alp", "Cru", "Gam"), ("Cru", "Bet", "Cru", "Del"),
    # Centaurus — the pointers
    ("Cen", "Alp", "Cen", "Bet"),
    # Boötes — the kite
    *_chain("Boo", "Alp", "Eps", "Del", "Bet", "Gam", "Alp"),
    ("Boo", "Alp", "Boo", "Eta"),
    # Corona Borealis — the arc
    *_chain("CrB", "The", "Bet", "Alp", "Gam", "Del", "Eps"),
    # Perseus
    ("Per", "Gam", "Per", "Alp"), ("Per", "Alp", "Per", "Del"),
    ("Per", "Alp", "Per", "Bet"),
    # Auriga — pentagon (classic figure borrows Beta Tau for the fifth corner)
    *_chain("Aur", "Alp", "Bet", "The", "Iot", "Eta", "Alp"),
    ("Aur", "Iot", "Tau", "Bet"),
    # Cepheus — the house
    *_chain("Cep", "Alp", "Bet", "Gam", "Iot", "Zet", "Alp"),
    # Great Square of Pegasus (one corner is Alpheratz in Andromeda)
    ("Peg", "Alp", "Peg", "Bet"), ("Peg", "Bet", "And", "Alp"),
    ("And", "Alp", "Peg", "Gam"), ("Peg", "Gam", "Peg", "Alp"),
    # Andromeda — the chain
    *_chain("And", "Alp", "Del", "Bet", "Gam"),
]
