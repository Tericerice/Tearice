/**
 * mic-voice-input — Web Speech API dictation with real microphone-device
 * pinning, live level meters, and Google speech-service reachability probing.
 *
 * Extracted and generalized from DeepSeek Harness (MIT):
 * https://github.com/deepseek-ai/deepseek-harness
 */

export {
  useVoiceInput,
  type VoiceInputOptions,
  type VoiceInputControl,
  type SpeechRecognitionLike,
  type SpeechRecognitionEventLike,
} from './use-voice-input.ts'

export {
  useMicDevices,
  type MicDevicesOptions,
  type MicDevicesControl,
  type MicDeviceInfo,
} from './use-mic-devices.ts'

export {
  probeGoogle,
  type GoogleProbeResult,
} from './probe-google.ts'
