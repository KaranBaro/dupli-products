import { useState } from "react";
import PropTypes from "prop-types";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Box,
  Divider,
  Collapsible,
  Icon,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";

const faqs = [
  {
    question: "How do I duplicate a product?",
    answer:
      "Go to Dashboard, search or find the product, click Duplicate, choose your options, then click Create duplicate.",
  },
  {
    question: "Can I duplicate multiple products at once?",
    answer:
      "Yes. Use Bulk duplicate. You can duplicate products by selected products, tag, product type, or collection.",
  },
  {
    question: "What product data gets copied?",
    answer:
      "The app uses Shopify product duplication, so product data like title, variants, prices, tags, vendor, type, and images can be copied based on your selected options.",
  },
  {
    question: "Can I copy metafields?",
    answer:
      "Yes. Keep Copy metafields enabled in the duplicate modal. If you turn it off, copied metafields will be removed from the duplicate product.",
  },
  {
    question: "Why is duplicate count limited?",
    answer:
      "The limit helps prevent timeout issues and keeps the app fast and safe for large stores.",
  },
  {
    question: "Why are products loading slowly?",
    answer:
      "Large products with many variants, images, or metafields can take longer to duplicate and refresh.",
  },
  {
    question: "Who should I contact for help?",
    answer:
      "Use the Support page to contact us by email or WhatsApp. Please include your store name and issue details.",
  },
];

function FAQItem({ question, answer, index }) {
  const [open, setOpen] = useState(index === 0);

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">
              {question}
            </Text>

            <Button
              variant="plain"
              onClick={() => setOpen((value) => !value)}
              ariaExpanded={open}
              ariaControls={`faq-${index}`}
            >
              <Icon source={open ? ChevronUpIcon : ChevronDownIcon} />
            </Button>
          </InlineStack>

          <Collapsible
            open={open}
            id={`faq-${index}`}
            transition={{
              duration: "300ms",
              timingFunction: "ease-in-out",
            }}
          >
            <Text as="p" tone="subdued">
              {answer}
            </Text>
          </Collapsible>
        </BlockStack>
      </Box>
    </Card>
  );
}



FAQItem.propTypes = {

  question: PropTypes.string.isRequired,

  answer: PropTypes.string.isRequired,

  index: PropTypes.number.isRequired,

};

export default function HelpPage() {
  return (
    <Page
      title="Help"
      subtitle="Learn how to use Dupli Products and solve common issues."
    >
      <BlockStack gap="400">
        <Card>
          <Box padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Quick Start
              </Text>

              <Text as="p">1. Go to Dashboard.</Text>
              <Text as="p">2. Search for a product by title or SKU.</Text>
              <Text as="p">3. Click Duplicate or Bulk duplicate.</Text>
              <Text as="p">4. Choose title, status, count, images, and metafields.</Text>
              <Text as="p">5. Click Create duplicate.</Text>
            </BlockStack>
          </Box>
        </Card>

        <Card>
          <Box padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Bulk Duplicate Options
              </Text>

              <Text as="p">You can duplicate products using:</Text>
              <Text as="p">• Selected products</Text>
              <Text as="p">• Product tag</Text>
              <Text as="p">• Product type</Text>
              <Text as="p">• Collection</Text>

              <Divider />

              <Text as="p" tone="subdued">
                For best performance, duplicate in smaller batches.
              </Text>
            </BlockStack>
          </Box>
        </Card>

        <Text as="h2" variant="headingMd">
          Frequently Asked Questions
        </Text>

        {faqs.map((faq, index) => (
          <FAQItem
            key={faq.question}
            question={faq.question}
            answer={faq.answer}
            index={index}
          />
        ))}

        <Card>
          <Box padding="400">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Still need help?
              </Text>

              <Text as="p" tone="subdued">
                Contact support with your store name and issue details.
              </Text>

              <InlineStack gap="200">
                <Button url="/app/support" variant="primary">
                  Contact Support
                </Button>

                <Button url="/app" variant="secondary">
                  Back to Dashboard
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}