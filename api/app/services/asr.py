import os
import logging

logger = logging.getLogger(__name__)

class ASRResult:
    def __init__(self, text: str, confidence: float, provider: str):
        self.text = text
        self.confidence = confidence
        self.provider = provider

class ASRProvider:
    def transcribe(self, wav_path: str) -> ASRResult:
        raise NotImplementedError("ASR Providers must implement transcribe")

class MockASRProvider(ASRProvider):
    def transcribe(self, wav_path: str) -> ASRResult:
        """Simple mock provider that returns a dummy transcript."""
        logger.info(f"Mock ASR transcribing: {wav_path}")
        return ASRResult(
            text="[Mock transcript: Mera card kho gaya hai use band kariye]",
            confidence=0.95,
            provider="MockASRProvider"
        )

# Factory to get ASR Provider based on environment variables
def get_asr_provider() -> ASRProvider:
    provider_type = os.getenv("ASR_PROVIDER", "mock").lower()
    if provider_type == "mock":
        return MockASRProvider()
    else:
        # Fallback to mock for prototype, but placeholder for real implementation
        logger.warning(f"ASR provider '{provider_type}' not supported in prototype. Falling back to Mock.")
        return MockASRProvider()
