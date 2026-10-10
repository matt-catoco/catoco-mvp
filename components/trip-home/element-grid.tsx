import { ElementTile, type ElementTileProps } from "./element-tile";

export type ElementGridProps = {
  tiles: (ElementTileProps & { key: string })[];
  onDark?: boolean;
  /** Trip Home's near-square cards: 2 columns under 640px, 3 at/above. */
  cards?: boolean;
};

/** Responsive 4-up grid of ElementTiles — matches the layout the homepage's
 * hand-built showcase used before this component existed. `cards` switches
 * to Trip Home's 3-up near-square card. */
export function ElementGrid({ tiles, onDark, cards }: ElementGridProps) {
  return (
    <div className={cards ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "grid grid-cols-2 gap-3.5 md:grid-cols-4"}>
      {tiles.map(({ key, ...tile }) => (
        <ElementTile key={key} onDark={onDark} variant={cards ? "card" : "square"} {...tile} />
      ))}
    </div>
  );
}
