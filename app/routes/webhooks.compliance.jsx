import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} compliance webhook for ${shop}`);

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Compliance webhook failed:", error);
    return new Response("OK", { status: 200 });
  }
};