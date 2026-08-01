import Image from "next/image";

/**
 * A screenshot that matches the visitor's theme.
 *
 * Both variants are rendered and swapped with the `dark:` class variant rather
 * than a <picture> element keyed on prefers-color-scheme. The app's source of
 * truth is the `.dark` class that theme-init.js sets from localStorage, which
 * can disagree with the OS: sign in, switch to dark, sign out, and the landing
 * page renders dark on a light-mode machine. Keying off the class is right in
 * that case; prefers-color-scheme would show the wrong screenshot.
 *
 * The cost is the second variant being fetched. Both are served resized by
 * next/image, so it is a small fraction of the source PNG.
 */
export function ProductShot({
  light,
  dark,
  alt,
  priority = false,
}: {
  light: string;
  dark: string;
  /** Applied to both variants — screen readers skip the hidden one. */
  alt: string;
  priority?: boolean;
}) {
  // alt is passed explicitly rather than through the spread: the a11y lint rule
  // does not follow spreads and reports a false positive otherwise.
  const shared = {
    width: 2880,
    height: 1800,
    priority,
    sizes: "(min-width: 1024px) 1024px, 100vw",
  };

  return (
    <>
      <Image {...shared} alt={alt} src={light} className="h-auto w-full dark:hidden" />
      <Image {...shared} alt={alt} src={dark} className="hidden h-auto w-full dark:block" />
    </>
  );
}
