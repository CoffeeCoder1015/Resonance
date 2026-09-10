import { useEffect, useRef, useState } from 'react';
import type { VisualTheme } from '../types/voice';
import { TranscriptionPill } from './transcription-pill/TranscriptionPill';

// Exact outputs collected through Resonance's lfm-transcription provider on 2026-09-09.
const EXAMPLES = [
  {
    kind: 'math', number: '01', label: 'For the equations in your head',
    title: 'Say the math. Keep the meaning.',
    description: 'Derivatives, initial conditions, and all. Spoken notation becomes a readable question, ready for your notes or the next conversation.',
    document: 'Differential equations', filename: 'study-notes.md',
    input: 'Solve the differential equation d y over d x plus two y equals e to the negative x, with the initial condition y of zero equals three.',
    output: 'Solve the differential equation dy/dx + 2y = e^(-x) with the initial condition y(0) = 3.',
    observation: 'The equation and initial condition survive the transformation. The question stays a question.',
  },
  {
    kind: 'code', number: '02', label: 'For the code you can already describe',
    title: 'A function, spoken out loud.',
    description: 'Describe a small piece of code in ordinary words. The refinement model can recover the syntax and structure, including indentation.',
    document: 'A little Python', filename: 'scratch.py',
    input: 'In Python, define a function called square that takes x and returns x times x.',
    output: '```python\ndef square(x):\n    return x * x\n```',
    observation: 'A spoken function definition becomes Python. This is the saved output, with its Markdown code fence rendered below.',
  },
  {
    kind: 'writing', number: '03', label: 'For the everyday words, too',
    title: 'Sometimes, your words are already right.',
    description: 'A quick message should still sound like you. Refinement also means knowing when a sentence can stay exactly as it is.',
    document: 'A quick message', filename: 'draft',
    input: 'Please send the revised contract to Maya before noon.',
    output: 'Please send the revised contract to Maya before noon.',
    observation: 'Same name. Same deadline. Same sentence. This run leaves the wording untouched.',
  },
] as const;

function StoryExample({ example, theme }: { example: typeof EXAMPLES[number]; theme: VisualTheme }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [playback, setPlayback] = useState(0);
  const [phase, setPhase] = useState<'recording' | 'processing' | 'done'>('done');
  const [characters, setCharacters] = useState(example.input.length);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    let played = false;
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting && !played) {
        played = true;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlayback(value => value + 1);
      }
    }, { threshold: 0.25 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (playback === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('done'); setCharacters(example.input.length);
      return;
    }
    setPhase('recording'); setCharacters(0);
    const started = performance.now();
    const interval = window.setInterval(() => {
      setCharacters(Math.min(example.input.length, Math.floor((performance.now() - started) / 2400 * example.input.length)));
    }, 40);
    const processing = window.setTimeout(() => {
      window.clearInterval(interval); setCharacters(example.input.length); setPhase('processing');
    }, 2400);
    const done = window.setTimeout(() => setPhase('done'), 3400);
    return () => { window.clearInterval(interval); window.clearTimeout(processing); window.clearTimeout(done); };
  }, [playback, example.input]);

  const replay = () => setPlayback(value => value + 1);
  return (
    <section className={`story-example story-example--${example.kind}`} ref={sectionRef} aria-labelledby={`example-${example.kind}`}>
      <div className="story-copy">
        <p className="section-kicker"><span>{example.number}</span> {example.label}</p>
        <h2 id={`example-${example.kind}`}>{example.title}</h2>
        <p>{example.description}</p>
        <p className="story-observation">{example.observation}</p>
      </div>
      <div className="story-demo">
        <div className="spoken-card">
          <span className="small-label">You say</span>
          <p aria-label={example.input}><span aria-hidden="true">{example.input.slice(0, characters)}{phase === 'recording' && <span className="cursor-block" />}</span></p>
        </div>
        <div className="story-editor">
          <div className="editor-toolbar"><span>{example.filename}</span><span>Local refinement</span></div>
          <div className="editor-body">
            <span className="small-label">{example.document}</span>
            <div className="editor-output" aria-live="polite">
              {phase !== 'done' ? <p className="editor-placeholder">{phase === 'recording' ? 'Listening…' : 'Refining your words…'}</p> : example.kind === 'code' ? (
                <pre><code>{example.output.replace(/^```python\n/, '').replace(/\n```$/, '')}</code></pre>
              ) : <p className={example.kind === 'math' ? 'math-output' : ''}>{example.output}</p>}
            </div>
          </div>
          <div className="story-editor-bottom">
            <span className="small-label">{phase === 'done' ? 'Text inserted' : phase === 'recording' ? 'Speaking' : 'Refining'}</span>
            {visible && <div className="story-pill"><TranscriptionPill status={phase === 'done' ? 'idle' : phase} visualTheme={theme} hovered scale={0.8} microphoneLevel={phase === 'recording' ? 0.35 : 0} onPrimaryAction={replay} /></div>}
          </div>
        </div>
        <div className="story-demo-footer"><span>Recorded model result · animated playback</span><button type="button" onClick={replay}>Replay example ↺</button></div>
      </div>
    </section>
  );
}

export function RefinementStory({ theme }: { theme: VisualTheme }) {
  return (
    <div className="refinement-story" id="refinement">
      <header className="story-heading">
        <p className="section-kicker">Beyond word for word</p>
        <h2>Your voice has more<br />than one kind of thought.</h2>
        <p>A message. A line of code. A differential equation. Here’s what Resonance’s local refinement model made of each.</p>
      </header>
      {EXAMPLES.map(example => <StoryExample key={example.kind} example={example} theme={theme} />)}
      <p className="results-note">These are selected, precomputed outputs from the local refinement provider. The playback is illustrative, not a speed measurement. Results vary; a quick review still matters.</p>
      <section className="training-story" aria-labelledby="training-title">
        <header className="training-heading">
          <p className="section-kicker">Behind the refinement</p>
          <h2 id="training-title">A small model.<br />A very particular job.</h2>
          <p>The challenge is keeping what you meant while changing how it’s written. Resonance’s refinement work starts with that distinction, from the training pairs to the finished text.</p>
        </header>
        <div className="training-pair">
          <p className="small-label">Building a training pair · illustrative example</p>
          <div><span>Start with written text</span><code>y′ + 2y = 0</code></div>
          <span className="pair-direction" aria-hidden="true">↓</span>
          <div><span>Reconstruct a spoken version</span><p>y prime plus two y equals zero</p></div>
          <p className="pair-caption">Generate speech-like inputs from clean targets, then train the model to make the return trip.</p>
        </div>
        <div className="training-steps">
          <article><span className="step-number">01 / Create the pairs</span><h3>Work backwards from clean text.</h3><p>A synthetic-data pipeline uses Gemma to reconstruct spoken versions of written material. Math, code, and ordinary prose give the model different kinds of structure to recover.</p></article>
          <article><span className="step-number">02 / Make the inputs varied</span><h3>Give the same meaning different forms.</h3><p>Context variations and punctuation and capitalization noise broaden the examples. Generation review and cleanup help keep the spoken input connected to its intended target.</p></article>
          <article><span className="step-number">03 / Train for the return trip</span><h3>Specialize a 1.2B model.</h3><p>LoRA fine-tuning adapts Liquid AI’s LFM2.5 base model using transcript-to-target pairs. The aim is to recover useful written form while retaining the speaker’s content.</p></article>
        </div>
        <dl className="training-facts"><div><dt>Training corpus</dt><dd>311,693 <span>pairs</span></dd></div><div><dt>Base model</dt><dd>1.2B <span>parameters</span></dd></div><div><dt>Fine-tuning</dt><dd>LoRA <span>adapters</span></dd></div></dl>
      </section>
      <section className="local-story" aria-labelledby="local-title">
        <p className="section-kicker">The whole path, on your computer</p>
        <h2 id="local-title">From your mic<br />to your next sentence.</h2>
        <ol className="local-pipeline"><li><span>01</span><h3>Speak</h3><p>The desktop shortcut captures your voice.</p></li><li><span>02</span><h3>Transcribe</h3><p>Whisper turns the recording into text.</p></li><li><span>03</span><h3>Refine</h3><p>The local model recovers written form.</p></li><li><span>04</span><h3>Keep going</h3><p>The result lands in your focused app.</p></li></ol>
        <p className="local-closing">Voice input and refinement, brought together in a Windows desktop app. The models run locally, with a little personality along the way.</p>
        <a className="back-to-demo" href="#page-title">Back to the demo ↑</a>
      </section>
    </div>
  );
}
