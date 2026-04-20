export type LogoEntry = {
  name: string;
  src: string;
  variant: "dark" | "light" | "invert";
  href?: string;
};

export const clientLogos: LogoEntry[] = [
  {
    name: "Microsoft",
    src: "/images/logos/microsoft.svg",
    variant: "dark",
    href: "/case-studies/transforming-management-frameworks-at-microsoft",
  },
];

export const partnerLogos: LogoEntry[] = [
  { name: "Microsoft Partner Network", src: "/images/logos/microsoft-partner.png", variant: "dark" },
  { name: "Protiviti", src: "/images/logos/protiviti.jpg", variant: "dark" },
  { name: "Salient7", src: "/images/logos/salient7.jpg", variant: "dark" },
  { name: "PS Hummingbird", src: "/images/logos/ps-hummingbird.jpg", variant: "dark" },
  { name: "Crush Networks", src: "/images/logos/crush-networks.jpg", variant: "dark" },
  { name: "Creospark", src: "/images/logos/creospark.jpg", variant: "dark" },
  { name: "eMark Consulting", src: "/images/logos/emark-consulting.jpg", variant: "dark" },
  { name: "Akumina", src: "/images/logos/akumina.png", variant: "dark" },
  { name: "Orchestry", src: "/images/logos/orchestry.jpg", variant: "dark" },
];

export const rotatorLogos: LogoEntry[] = [...clientLogos, ...partnerLogos];
