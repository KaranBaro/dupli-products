import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Box,
} from "@shopify/polaris";

export default function SupportPage() {
  return (
    <Page title="Support">
      <BlockStack gap="400">

        <Card>
          <Box padding="400">
            <BlockStack gap="200">
              <Text variant="headingMd">Contact Support</Text>

              <Text>Email: karanbaro.kb@gmail.com</Text>
              <Text>WhatsApp: +91 8107895012</Text>
            </BlockStack>
          </Box>
        </Card>

        <Card>
          <Box padding="400">
            <BlockStack gap="200">
              <Text variant="headingMd">Quick Help</Text>

              <Text tone="subdued">
                For fastest support, email us with your store name and issue.
              </Text>

              <InlineStack gap="200">
                <Button
                  url="mailto:karanbaro.kb@gmail.com"
                  variant="primary"
                >
                  Email Support
                </Button>

                <Button
                  url="https://wa.me/918107895012"
                  target="_blank"
                >
                  WhatsApp Chat
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        </Card>

      </BlockStack>
    </Page>
  );
}