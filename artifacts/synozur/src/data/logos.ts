export type LogoEntry = {
  name: string;
  src: string;
  variant: "dark" | "light" | "invert";
  href?: string;
};

export const clientLogos: LogoEntry[] = [
  { name: "Alaska Airlines", src: "/images/logos/alaska-airlines.png", variant: "light" },
  { name: "Chevron", src: "/images/logos/chevron.png", variant: "light" },
  { name: "Converse", src: "/images/logos/converse.png", variant: "light" },
  { name: "Dell Technologies", src: "/images/logos/dell-technologies.png", variant: "light" },
  { name: "Disney", src: "/images/logos/disney.png", variant: "light" },
  { name: "Ford", src: "/images/logos/ford.png", variant: "light" },
  { name: "Home Depot", src: "/images/logos/home-depot.png", variant: "light" },
  { name: "iS Clinical", src: "/images/logos/is-clinical.png", variant: "light" },
  { name: "Jaguar", src: "/images/logos/jaguar.png", variant: "light" },
  { name: "John Hancock", src: "/images/logos/john-hancock.png", variant: "light" },
  { name: "Kellogg's", src: "/images/logos/kelloggs.png", variant: "light" },
  { name: "McKesson", src: "/images/logos/mckesson.png", variant: "light" },
  { name: "Mercedes-Benz", src: "/images/logos/mercedes-benz.png", variant: "light" },
  {
    name: "Microsoft",
    src: "/images/logos/microsoft.png",
    variant: "light",
    href: "/case-studies/transforming-management-frameworks-at-microsoft",
  },
  { name: "NFL", src: "/images/logos/nfl.png", variant: "light" },
  { name: "Oxy", src: "/images/logos/oxy.png", variant: "light" },
  { name: "Pfizer", src: "/images/logos/pfizer.png", variant: "light" },
  { name: "Quest", src: "/images/logos/quest.png", variant: "light" },
  { name: "Santander", src: "/images/logos/santander.png", variant: "light" },
  { name: "Sony", src: "/images/logos/sony.png", variant: "light" },
  { name: "Yokohama", src: "/images/logos/yokohama.png", variant: "light" },
];
