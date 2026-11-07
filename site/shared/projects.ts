/** The recorded projects (projects/manifest.json in the repo root), by id. */
export const PROJECT_TITLES: Record<string, string> = {
  "318213127": "Scratch Bloons TD",
  "324569477": "Doom v0.2.4",
  "475073453": "Navier Stokes Fluid Simulation",
  "1201938491": "Linux 6.1.14-rv32ima On Scratch",
  "1274137785": "SGBE Gameboy emulator V1.20",
  "1312523445": "Glue3D Maze Demo",
};

export const projectTitle = (id: string): string => PROJECT_TITLES[id] ?? id;
