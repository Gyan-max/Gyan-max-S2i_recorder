import re

def generate_canonical_filename(
    domain: str,
    speaker_id: str,
    intent: str,
    scenario_set: str,
    scenario_no: int,
    example_no: int,
    clip_id: str
) -> str:
    """
    Generates a canonical filename for audio clips based on the format:
    <domain>_<speaker_id>_<intent_short>_<scenario_set>_s<scenario_no>e<example_no>_<clip_short>.wav
    
    Example: bnk_SPK0042_block_card_v2_s2e1_9f3a1c.wav
    """
    # Normalize domain to lowercase
    domain_clean = domain.lower()
    
    # Strip domain prefix from intent (e.g. 'BNK.block_card' -> 'block_card')
    intent_short = intent
    if "." in intent:
        intent_short = intent.split(".", 1)[1]
    
    # Normalize intent_short (replace spaces or hyphens with underscores)
    intent_short = re.sub(r'[^a-zA-Z0-9_]', '_', intent_short).lower()
    
    # Get short clip ID (first 6 characters)
    clip_short = clip_id[:6]
    
    # Format components
    filename = f"{domain_clean}_{speaker_id.replace('_', '')}_{intent_short}_{scenario_set}_s{scenario_no}e{example_no}_{clip_short}.wav"
    return filename
