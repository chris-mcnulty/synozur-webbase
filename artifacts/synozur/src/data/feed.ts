export interface FeedItem {
  id: string;
  category: "EVENT" | "PODCAST" | "INSIGHT" | "WEBINAR" | "CASE STUDY";
  title: string;
  image: string;
  href: string;
  external?: boolean;
}

export const feedItems: FeedItem[] = [
  {
    id: "techcon-365-seattle",
    category: "EVENT",
    title: "TechCon 365 Seattle",
    image: "/images/home/feed/feed-1-techcon-365.jpeg",
    href: "https://www.synozur.com/event-details/techcon-365-seattle",
    external: true,
  },
  {
    id: "polaris-strategy-unplugged-with-dr-john-hillen",
    category: "PODCAST",
    title: "Strategy Dialogues with Dr. John Hillen",
    image: "/images/home/feed/feed-2-strategy-dialogues.jpeg",
    href: "/polaris",
  },
  {
    id: "holiday-reflections-from-synozur-a-dynamic-2024",
    category: "INSIGHT",
    title: "2024 - A Dynamic Year",
    image: "/images/home/feed/feed-3-dynamic-2024.jpg",
    href: "/insights",
  },
  {
    id: "transforming-your-digital-workplace-akumina",
    category: "WEBINAR",
    title: "Transform Your Digital Workplace",
    image: "/images/home/feed/feed-4-digital-workplace.jpg",
    href: "https://www.synozur.com/webinars/transforming-your-digital-workplace-akumina",
    external: true,
  },
  {
    id: "energy-company-reinvents-employee-expereince-and-effectiveness",
    category: "CASE STUDY",
    title: "Energizing Employee Experience",
    image: "/images/home/feed/feed-5-employee-experience.jpg",
    href: "/case-studies/energy-company-reinvents-employee-expereince-and-effectiveness",
  },
  {
    id: "transforming-management-frameworks-at-microsoft",
    category: "CASE STUDY",
    title: "Transforming Marketing Management at Microsoft",
    image: "/images/home/feed/feed-6-marketing-microsoft.jpg",
    href: "/case-studies/transforming-management-frameworks-at-microsoft",
  },
  {
    id: "polaris-ai-predictions-2025",
    category: "PODCAST",
    title: "AI Predictions for 2025",
    image: "/images/home/feed/feed-7-ai-predictions.jpg",
    href: "/polaris",
  },
];
