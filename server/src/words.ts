// Secret words for Imposter mode, each with words a player who knows it might say. The
// associations power the local content check when Gemini isn't available.

const RAW = `
lighthouse: ocean sea light ship coast tower beam keeper rock storm
pancake: breakfast syrup flat stack butter flip batter griddle maple
volcano: lava eruption mountain ash hot magma erupt smoke island
penguin: bird ice cold antarctica black white waddle swim fish
umbrella: rain wet open handle weather drizzle storm shade folding
guitar: music strings play song chords band acoustic electric strum
pizza: cheese slice tomato dough oven pepperoni delivery italian crust
rocket: space launch moon fuel astronaut nasa fly blast orbit
library: books read quiet shelves borrow librarian study card
cactus: desert spikes plant prickly dry water sand green thorns
snowman: snow winter cold carrot scarf frosty build melt ball
castle: king queen tower walls moat knight medieval stone princess
dinosaur: extinct fossil big reptile jurassic bones tyrannosaurus prehistoric scales
toothbrush: teeth brush bristles toothpaste morning bathroom clean dentist
bicycle: ride wheels pedal bike chain helmet handlebars cycle seat
camera: photo picture lens flash shoot film zoom snap
piano: keys music play black white notes pianist grand keyboard
waterfall: water fall river cliff mist splash flowing rocks niagara
dragon: fire wings fly breathe scales myth fantasy beast tail
popcorn: movie butter corn pop salty kernels snack cinema microwave
sandcastle: beach sand bucket build tide moat shovel waves
telescope: stars space lens look astronomy planets sky moon zoom
skateboard: wheels board trick ride ramp deck skate park ollie
hammock: relax swing hang trees nap rope lazy backyard
igloo: ice snow eskimo cold dome blocks arctic house
tornado: wind storm spin funnel twister weather destroy kansas
carousel: horses ride spin fair music round merry kids
balloon: air float party helium pop string birthday colorful
sunflower: yellow flower sun seeds tall petals garden field
octopus: tentacles arms ocean sea ink eight squid swim
treehouse: tree wood kids climb ladder fort backyard branches
fireworks: sky explode colors night bang july celebrate sparkle
chocolate: sweet cocoa candy bar dark milk brown dessert melt
helicopter: fly blades rotor pilot hover chopper air spin
backpack: school bag carry books straps zipper hike shoulders
spaceship: space alien fly stars rocket travel galaxy pilot
lemonade: lemon drink sour sweet summer stand juice yellow
submarine: underwater ocean sea dive navy periscope deep yellow
scarecrow: farm crows field straw hat corn birds pumpkin
trampoline: jump bounce backyard spring high flip kids net
microwave: kitchen heat food warm popcorn beep minutes oven
parachute: jump sky fall plane skydive float land open
compass: north direction navigate needle map south lost magnet
hourglass: sand time glass flip timer minutes pour
harmonica: music mouth blow instrument blues play notes small
robot: machine metal computer artificial beep build arm programmed
pirate: ship treasure sea parrot sword captain hook eyepatch gold
mermaid: tail ocean sea fish princess swim myth ariel scales
volleyball: net ball beach team spike serve hit sand court
astronaut: space suit moon nasa rocket helmet float orbit
blanket: warm bed soft cover sleep cozy wool cold fluffy
bubble: soap pop float air round blow bath wand
candle: wax flame light fire wick birthday burn melt smell
diamond: ring jewel shiny expensive sparkle rock gem precious hard
elevator: floors up down building button lift doors ride
feather: bird light soft fly float pillow quill wing
garden: plants flowers vegetables grow soil dig water seeds
hamburger: burger beef bun cheese meat fries grill fast ketchup
icecream: cold sweet cone scoop vanilla dessert melt summer chocolate
jellyfish: ocean sting sea tentacles transparent float clear swim
kangaroo: australia jump hop pouch baby tail marsupial joey
ladder: climb steps up rungs tall reach painter roof
magnet: metal attract stick fridge north south pull iron
necklace: jewelry neck chain beads pendant wear gold silver
orchestra: music violin conductor symphony instruments concert play classical
passport: travel country stamp airport photo document border international
quilt: blanket sewing patches warm bed grandma fabric stitch
rainbow: colors rain sky arch sun red violet pot gold
scissors: cut paper sharp blades snip craft hair
tractor: farm field plow drive green wheels crops farmer
unicorn: horn horse magic rainbow myth fantasy white sparkle
violin: strings bow music play orchestra classical fiddle notes
wheelbarrow: garden wheel push dirt carry handles soil
xylophone: music mallet bars notes hit instrument play colorful
yacht: boat sail sea rich water luxury ocean deck
zebra: stripes black white horse africa safari zoo savanna
anchor: ship boat heavy chain sea drop metal dock
barbecue: grill meat smoke summer outdoor burgers charcoal sauce
cupcake: frosting sweet cake sprinkles birthday bake small dessert
doorbell: ring door house visitor button ding dong chime
envelope: letter mail stamp paper seal post send address
flashlight: light dark battery torch beam camping night shine
glacier: ice cold mountain melt frozen arctic huge slow
headphones: music ears listen sound wireless audio noise speakers
island: water ocean beach palm sand tropical surrounded boat
jigsaw: puzzle pieces picture fit table edges assemble
kite: wind fly string sky tail beach high paper
lantern: light lamp glow candle dark camping paper hang
mailbox: letters mail post box delivery address flag
noodles: pasta ramen soup bowl chopsticks long slurp asian
oven: bake kitchen hot cook bread heat stove roast
pyramid: egypt pharaoh desert triangle ancient tomb stone sand
quarterback: football throw team pass touchdown ball field
raccoon: mask trash night animal stripes tail steal bandit
saxophone: jazz music brass blow instrument notes play gold
tent: camping outdoors sleep poles canvas zip campsite
unicycle: wheel one balance circus ride pedal juggle
vacuum: clean dust floor carpet suck noise hoover
waffle: breakfast syrup squares butter iron batter crispy
yoyo: string toy spin up down trick roll
zipper: jacket close teeth pull pants bag zip
airport: planes flight travel terminal gate luggage security pilot
bakery: bread cakes oven baker pastries fresh croissant flour
cave: dark rock underground bats explore stone deep tunnel
desert: sand hot dry camel cactus sun dunes sahara
eagle: bird fly wings feathers prey bald talons sky
forest: trees woods green nature leaves animals hike deer
goldfish: fish bowl orange pet swim water tank small
hospital: doctor nurse sick patient medicine ambulance bed surgery
iceberg: ice ocean cold titanic float frozen arctic tip
jungle: trees rainforest animals monkeys vines tropical tarzan wild
keyboard: typing computer keys letters piano buttons type
lobster: seafood ocean claws red shell maine eat crab
moon: night sky space crescent full astronaut crater orbit
nest: bird eggs twigs tree baby branch build
owl: bird night hoot wise eyes feathers nocturnal
parrot: bird talk colorful feathers pirate tropical green repeat
quicksand: sink sand trap stuck mud jungle desert
rollercoaster: ride loop fast scream amusement park track thrill
snail: slow shell slimy garden crawl slime antennae
train: tracks railway station engine passengers ride whistle tunnel
violet: purple flower color petals plant small spring
windmill: wind blades farm spin holland energy turn tower
yogurt: dairy breakfast cup spoon fruit creamy healthy milk
zoo: animals cages lions visit monkeys tigers keeper elephants
apple: fruit red green tree pie crunchy eat orchard
banana: fruit yellow peel monkey potassium bunch tropical
carrot: vegetable orange rabbit crunchy garden root eat
donut: sweet glazed hole sprinkles coffee fried dough pink
egg: chicken shell yolk breakfast fried scrambled boil white
fork: eat utensil prongs knife spoon table food dinner
grapes: fruit purple green vine wine bunch juicy
honey: bees sweet sticky golden hive bear jar
jacket: coat wear warm zipper sleeves cold pockets
kettle: tea boil water whistle hot kitchen spout
lemon: sour yellow fruit citrus juice squeeze tart
mushroom: fungus forest pizza cap stem grow mario
nachos: chips cheese mexican salsa snack jalapeno crunchy
onion: vegetable layers cry cooking smell peel white
pillow: sleep bed soft head fluffy rest feathers
queen: king crown royal palace throne england rule
rose: flower red thorns petals valentine smell garden
sandwich: bread lunch ham cheese slice sub eat
tiger: stripes cat orange jungle roar wild big
umpire: baseball referee call strike out game rules
vase: flowers glass water table decoration ceramic
watermelon: fruit summer green red seeds juicy slice
yarn: knitting wool ball cat thread sweater soft
zipline: ride cable fast trees harness slide adventure
basketball: hoop dribble court ball team shoot nba dunk
coffee: drink morning caffeine cup bean hot espresso
dentist: teeth doctor drill clean cavity checkup brush
eyeglasses: glasses see lenses frames vision read wear
fridge: cold food kitchen milk refrigerator freezer door
globe: earth world map round countries spin geography
hammer: nail tool hit build wood construction carpenter
jeans: pants denim blue wear legs pockets
ketchup: tomato sauce red fries bottle burger squeeze
lollipop: candy stick sweet lick sugar round colorful
marshmallow: sweet campfire fluffy roast white smores soft
newspaper: news read paper headlines morning print journalist
oyster: shell pearl ocean seafood sea raw
quiz: questions test answers trivia school score
river: water flow stream boat bank fish current
sock: foot wear pair laundry warm shoe wool
teapot: tea pour spout kettle hot cup
vampire: blood fangs night bat dracula bite coffin
wallet: money cards pocket cash leather purse
astronomy: stars planets telescope space sky galaxy
bowling: pins ball lane strike alley shoes spare
crayon: color draw wax kids paper box art
drum: beat music sticks band rhythm loud bang
elephant: trunk big gray tusks africa ears zoo
firetruck: fire red ladder siren firefighter hose emergency
giraffe: tall neck spots africa leaves zoo long
hotdog: sausage bun mustard ketchup grill baseball
ink: pen black write blot printer tattoo octopus
juggler: balls circus throw catch clown tricks
koala: australia tree eucalyptus bear sleep gray cute
monkey: banana tree jungle climb ape zoo tail
ninja: japan sword stealth black martial fight
ostrich: bird big fast run africa eggs neck
pumpkin: orange halloween pie carve seeds patch jack
rain: water wet clouds umbrella storm drops weather
shark: ocean teeth fin fish bite jaws swim
television: tv watch shows screen remote channel news
whale: ocean big mammal blue sea swim spout
snowflake: snow winter cold white flake crystal ice unique
chess: king queen pawn board checkmate knight game strategy
sushi: rice fish japanese raw roll seaweed chopsticks
tortoise: shell slow reptile old turtle green
trophy: win gold award cup prize champion first
sled: snow hill winter slide ride cold downhill
mirror: reflection glass look face bathroom see
ghost: spooky haunted boo white halloween scary dead
fountain: water park coins spray wish statue splash
crown: king queen gold jewels royal head throne
hedgehog: spikes small animal cute prickly sonic
calendar: dates days months year schedule wall
tambourine: music shake jingle instrument tap band
cookie: chocolate chip bake sweet jar milk crumbs
spider: web legs eight bug crawl scary insect
`;

export const WORDS: ReadonlyMap<string, readonly string[]> = new Map(
  RAW.trim()
    .split('\n')
    .map((line) => {
      const [word = '', rest = ''] = line.split(':');
      return [word.trim(), rest.trim().split(/\s+/)] as const;
    })
    .filter(([word]) => /^[a-z]+$/.test(word)),
);

export function pickWord(): string {
  const words = [...WORDS.keys()];
  return words[Math.floor(Math.random() * words.length)]!;
}

/** Lowercased, punctuation-free tokens, with a light plural strip so "ships" matches "ship". */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/'/g, '').replace(/(s|x|ch|sh)es$/, '$1').replace(/(?<=[a-z]{2}[^s])s$/, ''));
}

/** How many of the answer's words relate to the secret word. */
export function relatedHits(word: string, text: string): number {
  const related = new Set(tokens([word, ...(WORDS.get(word) ?? [])].join(' ')));
  return tokens(text).filter((t) => related.has(t)).length;
}

// Placeholder detective lines until Gemini writes them in M3.

export const BASELINE_QUESTIONS = [
  'Say your name, and what you ate today.',
  'Tell me your name, and where you grew up.',
  "Say your name, and what you did this morning.",
  "Tell me your name, and your favourite snack.",
];

export const QUESTIONS = [
  'Describe it in three words.',
  'When did you last see one?',
  'Where would you usually find it?',
  'What colour do you picture?',
  'Who would want one?',
  'What does it remind you of?',
  'Is it bigger than a car? Explain.',
  'What sound does it make?',
  'Would you take it on holiday?',
  'What would you do with one?',
];

export const FOLLOWUPS = [
  'You hesitated. Tell me one more thing about it.',
  "Hm. And how does it make you feel?",
  'Interesting. Where did you first come across one?',
  'Say that again, slower this time. What is it like?',
];

export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
