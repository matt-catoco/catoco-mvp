import { ElementTile, type ElementTileProps } from "./element-tile";

export type ElementGridProps = {
  tiles: (ElementTileProps & { key: string })[];
  onDark?: boolean;
};

/** Responsive 4-up grid of ElementTiles — matches the layout the homepage's
 * hand-built showcase used before this component existed. */
export function ElementGrid({ tiles, onDark }: ElementGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
      {tiles.map(({ key, ...tile }) => (
        <ElementTile key={key} onDark={onDark} {...tile} />
      ))}
    </div>
  );
}
