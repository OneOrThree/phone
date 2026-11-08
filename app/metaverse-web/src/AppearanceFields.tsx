import { catColors, NAME_MAX, type CatColor } from "./world";
import { coats } from "./theme";

const colorNames: Record<CatColor, string> = {
  cream: "크림",
  peach: "치즈",
  gray: "회색",
  black: "검정",
  white: "흰색",
  brown: "갈색",
};

export function AppearanceFields({
  name,
  color,
  onName,
  onColor,
  onBlur,
  welcome = false,
}: {
  name: string;
  color: CatColor;
  onName: (name: string) => void;
  onColor: (color: CatColor) => void;
  onBlur?: () => void;
  welcome?: boolean;
}) {
  return (
    <>
      <label className="field-label" htmlFor="cat-name">
        섬에서 부를 이름
      </label>
      <input
        id="cat-name"
        maxLength={NAME_MAX}
        value={name}
        onChange={(e) => onName(e.target.value)}
        onBlur={onBlur}
        autoFocus={welcome}
        autoComplete="nickname"
        required={welcome}
        placeholder={welcome ? "어떤 이름으로 불러 드릴까요?" : undefined}
        aria-describedby={welcome ? "name-hint" : undefined}
      />
      {welcome && (
        <p className="name-hint" id="name-hint">
          1~16자 · 섬의 이웃에게 보이는 이름이에요.
        </p>
      )}
      <fieldset>
        <legend>털색</legend>
        <div className="swatches">
          {catColors.map((c) => (
            <button
              type="button"
              key={c}
              className={color === c ? "active" : ""}
              style={{ "--coat": coats[c] } as React.CSSProperties}
              onClick={() => onColor(c)}
              aria-label={`${colorNames[c]} 고양이`}
              aria-pressed={color === c}
            >
              <span />
              {colorNames[c]}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
