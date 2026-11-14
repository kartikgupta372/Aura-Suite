export interface Story { id: string; title: string; color: string; lines: string[] }
export const stories: Story[] = [
  { id: 'cat', title: 'The Cat', color: 'var(--c1)', lines: ['The cat sat on the mat.', 'The cat is big and red.', 'The cat likes to nap.'] },
  { id: 'sun', title: 'The Sun', color: 'var(--c3)', lines: ['The sun is up.', 'Birds sing in the tree.', 'It is a bright day.'] },
  { id: 'dog', title: 'My Dog', color: 'var(--c2)', lines: ['I have a dog.', 'His name is Bruno.', 'He can run and jump.', 'I love my dog.'] },
  { id: 'rain', title: 'Rain', color: 'var(--c5)', lines: ['Look at the rain.', 'Drip, drop, drip, drop.', 'I wear my red boots.', 'I jump in the puddles.'] },
  { id: 'mango', title: 'Mango Time', color: 'var(--c4)', lines: ['Mom has a mango.', 'It is sweet and yellow.', 'We eat it with a spoon.', 'Yum, yum, yum!'] },
  { id: 'moon', title: 'The Moon', color: 'var(--c3)', lines: ['The moon is high.', 'Stars twinkle in the sky.', 'It is time for bed.', 'Good night, moon.'] },
]
export const totalLines = (id: string) => stories.find((s) => s.id === id)?.lines.length ?? 0
