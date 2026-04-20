import { useEffect } from "react";

interface MetaProps {
  title: string;
  description?: string;
}

export function Meta({ title, description }: MetaProps) {
  useEffect(() => {
    document.title = `${title} | The Synozur Alliance`;
    if (description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', description);
    }
  }, [title, description]);

  return null;
}
