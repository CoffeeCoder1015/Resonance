import { PresetTopic } from '../types/voice';

export const SIMULATED_CONVERSATIONS: PresetTopic[] = [
  {
    id: 'clay-vibe',
    userPrompt: "How does Neobrutalist color design transform digital dialogue?",
    agentResponse: "It brings immediate joy and clarity! By combining sunny saturated background hues, tactile thick borders, and hard offset shadows with zero blur, every acoustic interaction feels energetic, friendly, and physically alive!"
  },
  {
    id: 'toy-physics',
    userPrompt: "Why do bouncy ceramic clay and glossy toy materials feel so delightful?",
    agentResponse: "Because they appeal to our playful sense of touch! Seeing a high-gloss candy sphere or smooth vinyl clay blob deform and bounce to the cadence of spoken words bridges computer logic with childhood creativity."
  },
  {
    id: 'upbeat-rhythm',
    userPrompt: "Can we compose a energetic poem about color and sound?",
    agentResponse: "A splash of lemon yellow light, a thick black outline shiny and bright! The candy waves bounce high and bold, the most playful dialogue ever told!"
  },
  {
    id: 'color-harmony',
    userPrompt: "What makes high-contrast graphic depth superior to gloomy dark modes?",
    agentResponse: "While dark modes can feel cold and detached, Neobrutalism shines like sunshine! Hard stamped shadows create an unmistakable poster-like elevation that demands your attention without sacrificing simplicity."
  },
  {
    id: 'superflat-joy',
    userPrompt: "Why do Takashi Murakami's smiling flowers feel instantly joyful?",
    agentResponse: "They speak the visual language of kawaii culture: twelve flat rainbow petals in perfect radial balance, zero shading, maxed saturation, and a grinning sun face at the center. The smile is the interface — friendly, bold, and alive the moment it flutters."
  },
  {
    id: 'future-voice',
    userPrompt: "What happens when an intelligent agent looks like a modern collectible art toy?",
    agentResponse: "Technology suddenly feels friendly and approachable! Rather than a sterile computational machine, your acoustic companion becomes an inspiring piece of kinetic modern art."
  }
];

export function getIntelligentResponse(userText: string): string {
  const lower = userText.toLowerCase().trim();
  
  if (!lower || lower.length < 2) {
    return "I am listening! Say anything on your mind to spark this playful dialogue.";
  }
  
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.includes('good morning')) {
    return "Hello! My bouncy 3D acoustic engines are warmed up and radiating positive vibes. What shall we discover today?";
  }
  if (lower.includes('name') || lower.includes('who are you')) {
    return "I am your vibrant acoustic conversational companion! Built with energetic Neobrutalist design and tactile 3D material physics.";
  }
  if (lower.includes('color') || lower.includes('vibrant') || lower.includes('yellow') || lower.includes('pink') || lower.includes('design')) {
    return "Neobrutalism loves bold contrasts! Thick black outlines, hard offset shadows, and sunny pop hues make human-computer interactions feel like an upbeat creative workshop.";
  }
  if (lower.includes('clay') || lower.includes('toy') || lower.includes('plastic') || lower.includes('physics') || lower.includes('3d')) {
    return "Our Three.js shaders simulate soft matte vinyl ceramic clay and high-gloss candy plastics. Every syllable you utter pushes virtual acoustic forces across these tactile meshes!";
  }
  if (lower.includes('poem') || lower.includes('poetry') || lower.includes('fun') || lower.includes('happy') || lower.includes('music')) {
    return "Feel the rhythm in the air: sunny colors everywhere! When our vocal harmonies sing, kinetic magic is in every ring!";
  }
  if (lower.includes('thank') || lower.includes('cool') || lower.includes('awesome') || lower.includes('beautiful') || lower.includes('love')) {
    return "Thank you so much! Your words bring an immediate smile to my acoustic neural network. It's a joy conversing with you in this bright sanctuary!";
  }

  const responses = [
    `That is such a fantastic point about "${userText.slice(0, 32)}"! Looking at it through a colorful creative lens unlocks wonderful new possibilities and energetic ideas.`,
    `I love your enthusiasm about "${userText.slice(0, 30)}"! Our synthesis reveals a vibrant, bouncing synergy between structure and dynamic spontaneity.`,
    `I'm actively processing that! In the cheerful context of tactile acoustics, your idea opens up a playground of inspirational design and interactive flow.`,
    `An inspiring observation! When we blend simplicity with upbeat Neobrutalist aesthetics, we make genuine human dialogue shine.`
  ];

  return responses[Math.floor(Math.random() * responses.length)];
}

export function formatTimestamp(date: Date = new Date()): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
