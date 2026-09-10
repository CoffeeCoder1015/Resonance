export type VoiceState = 'idle' | 'listening' | 'processing';

// Retained only so the unmounted legacy website components continue to typecheck.
export type AgentState = VoiceState | 'speaking';

export type VoiceInputMode = 'hold' | 'tap';

export type VoicePhase =
  | 'idle'
  | 'acquiring-microphone'
  | 'listening'
  | 'transcribing'
  | 'responding';

export type VisualTheme =
  | 'clay-blob'       // 3D Bouncy Ceramic Clay Blob (Canary Yellow mood)
  | 'toy-collider'    // 3D Pop Toy Candy Collider (Electric Mint mood)
  | 'memphis-bloom'   // 3D Memphis Geometric Bloom (Coral Pop mood)
  | 'comic-burst'     // 3D Pop Art Comic Burst (Electric Cyan mood)
  | 'superflat-bloom' // 3D Superflat Smiling Flower (Lilac Pop mood)
  | 'voxel-pulse';    // 3D Voxel Pulse Shell (Peach Pop mood)

export interface ThemeDescriptor {
  id: VisualTheme;
  name: string;
  philosophy: string;
  badge: string;
  bgHex: string;
  accentHex: string;
  accentForegroundHex: string;
  textColor: string;
}

export const DESIGN_VARIANTS: ThemeDescriptor[] = [
  {
    id: 'clay-blob',
    name: '3D Bouncy Ceramic Clay',
    philosophy: 'Claymorphism & Vinyl Art Toys. A playful matte peach clay sphere that bounces and grows exuberant organic acoustic knobs when energized by your voice.',
    badge: 'Ceramic Clay',
    bgHex: '#FFF480', // Sunny Canary Yellow
    accentHex: '#FF69B4', // Hot Pink
    accentForegroundHex: '#000000',
    textColor: 'text-zinc-950'
  },
  {
    id: 'toy-collider',
    name: '3D Pop Candy Collider',
    philosophy: 'High-gloss toy plastic mechanics. A joyful constellation of bouncy neon marbles (electric pink, lemon, turquoise) that scatter outward with speech decibels.',
    badge: 'Candy Toy 3D',
    bgHex: '#C6F6D5', // Electric Mint Pop
    accentHex: '#F6AD55', // Orange Sunshine
    accentForegroundHex: '#000000',
    textColor: 'text-zinc-950'
  },
  {
    id: 'memphis-bloom',
    name: '3D Memphis Geometric Bloom',
    philosophy: 'Ettore Sottsass\' 1981 Memphis movement. Bold primary cones, cubes, and tori orbit a black core, blooming outward in clashing asymmetric confetti when you speak.',
    badge: 'Memphis Bloom',
    bgHex: '#FFADAD', // Coral Pop
    accentHex: '#03045E', // Deep Navy
    accentForegroundHex: '#FFFFFF',
    textColor: 'text-zinc-950'
  },
  {
    id: 'comic-burst',
    name: '3D Pop Art Comic Burst',
    philosophy: 'Roy Lichtenstein\'s comic printing grammar. A cel-shaded primary ball wrapped in thick ink outlines, flanked by spiky POW starbursts that detonate on every syllable.',
    badge: 'Comic Burst',
    bgHex: '#4CC9F0', // Electric Cyan
    accentHex: '#FFD60A', // Sunshine Yellow
    accentForegroundHex: '#000000',
    textColor: 'text-zinc-950'
  },
  {
    id: 'superflat-bloom',
    name: '3D Superflat Smiling Flower',
    philosophy: 'Takashi Murakami\'s Superflat theory. Twelve flat rainbow petals in radial balance around a grinning kawaii face — zero shading, maxed saturation, pure joy that flutters open as you speak.',
    badge: 'Superflat Bloom',
    bgHex: '#C8B6FF', // Lilac Pop
    accentHex: '#FF006E', // Party Pink
    accentForegroundHex: '#000000',
    textColor: 'text-zinc-950'
  },
  {
    id: 'voxel-pulse',
    name: '3D Voxel Pulse Shell',
    philosophy: 'Retro voxel stylization. A sphere of chunky orthogonal cubes quantized to a five-color neobrutalist palette, rippling in traveling pixel waves with every spoken syllable.',
    badge: 'Voxel Pulse',
    bgHex: '#FFD6A5', // Peach Pop
    accentHex: '#023047', // Deep Navy
    accentForegroundHex: '#FFFFFF',
    textColor: 'text-zinc-950'
  }
];

export interface DialogueTurn {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface AudioSignal {
  volume: number;
  frequencies: Uint8Array;
  state: AgentState;
}

export interface PresetTopic {
  id: string;
  userPrompt: string;
  agentResponse: string;
  duration?: number;
}
