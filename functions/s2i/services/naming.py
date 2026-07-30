"""
Canonical clip filenames.

Ported verbatim from the FastAPI build - the dataset manifest, the research
ZIP layout and any downstream tooling all parse this format, so it must not
drift. Pure string logic, no Firestore, which also makes it directly testable.
"""

import re


def generate_canonical_filename(
    domain: str,
    speaker_id: str,
    intent: str,
    scenario_set: str,
    scenario_no: int,
    example_no: int,
    clip_id: str,
    speaker_name: str = "",
) -> str:
    """
    <domain>_<speaker_label>_<intent_short>_<scenario_set>_s<n>e<n>_<clip_short>.wav

    Example: bnk_rahul_sharma_block_card_v2_s2e1_9f3a1c.wav
    """
    domain_clean = domain.lower()

    intent_short = intent
    if "." in intent:
        intent_short = intent.split(".", 1)[1]
    intent_short = re.sub(r"[^a-zA-Z0-9_]", "_", intent_short).lower()

    clip_short = clip_id[:6]

    if speaker_name and speaker_name.strip():
        label = re.sub(r"[^a-zA-Z0-9_.-]", "_", speaker_name.strip()).lower()
        label = re.sub(r"_+", "_", label).strip("_")
        # Collapse dot runs. The character class above keeps "." so names like
        # "Dr. Smith" survive intact, but that also lets ".." through, and
        # these filenames are later written into a research ZIP that someone
        # extracts to disk. Single dots are unaffected, so real names produce
        # byte-identical output to the FastAPI build.
        label = re.sub(r"\.{2,}", ".", label).strip(".-") or "speaker"
    else:
        label = speaker_id.replace("_", "")

    return (
        f"{domain_clean}_{label}_{intent_short}_{scenario_set}"
        f"_s{scenario_no}e{example_no}_{clip_short}.wav"
    )
