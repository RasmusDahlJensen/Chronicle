import { ERA_NAMES, simulationDate, type ChronicleEvent, type ObserverFrame } from '../../shared/simulation.ts';
import { describeEvent } from '../observer/events.ts';
import { describeStory } from '../observer/stories.ts';

type Story = ObserverFrame['stories'][number];
const number = new Intl.NumberFormat('en');

/**
 * The story rail (U.3; the "Chronicle" direction): the history's main stories now, the story of the age first, each
 * with its kind, title, what happened, why and its years. Choosing one shows it on the map and lists its key events.
 */
export function StoryRail({ stories, chosen, onChoose, names }: { stories: ObserverFrame['stories']; chosen: string | null; onChoose: (story: Story) => void; names: (id: number) => string }) {
  if (!stories.length) return <p className="game-muted">No great stories yet: the first peoples are still finding their way.</p>;
  return <ol className="game-stories" aria-label="Stories of the age">{stories.map((story, at) => {
    const told = describeStory(story), open = chosen === story.id;
    return <li key={story.id} data-story-kind={story.kind}>
      <button type="button" className={at === 0 ? 'game-story game-story-lead' : 'game-story'} aria-pressed={open} onClick={() => onChoose(story)}>
        <span className="game-story-kind">{at === 0 ? `The story of the age · ${told.kind}` : told.kind}<span className="game-story-years">{told.years}</span></span>
        <span className="game-story-title">{told.title}</span>
        <span className="game-story-text">{told.text}</span>
        {told.why && <span className="game-story-why">{told.why}</span>}
      </button>
      {open && story.events.length > 0 && <ol className="game-story-events" aria-label="From the record">{story.events.map(event => <StoryEvent key={event.id} event={event} names={names} />)}</ol>}
    </li>;
  })}</ol>;
}

function StoryEvent({ event, names }: { event: ChronicleEvent; names: (id: number) => string }) {
  return <li><span className="game-event-year">{number.format(simulationDate(event.tick).year)}</span><span>{describeEvent(event, names)}</span></li>;
}

/** The ages of the world (U.3): from year 0 to now, each age from the year a people first reached it. */
export function Ages({ ages, year }: { ages: ObserverFrame['ages']; year: number }) {
  const marks = [{ era: 0, year: 0, name: null as string | null, tech: null as string | null }, ...ages];
  return <ol className="game-ages" aria-label="The ages">{marks.map((age, at) => {
    const end = marks[at + 1]?.year ?? year, span = Math.max(0, end - age.year), now = at === marks.length - 1;
    return <li key={age.era} className={now ? 'game-age-now' : undefined} style={{ flexGrow: Math.max(span, year / 25, 1) }}
      title={age.name ? `${ERA_NAMES[age.era]} age from year ${number.format(age.year)}: the ${age.name} first learn ${age.tech}` : 'Stone age from year 0'}>
      <span className="game-age-name">{ERA_NAMES[age.era]}</span> <span className="game-age-year">{number.format(age.year)}</span>
      {age.name && <span className="game-sr-only">, first the {age.name}</span>}
    </li>;
  })}</ol>;
}
