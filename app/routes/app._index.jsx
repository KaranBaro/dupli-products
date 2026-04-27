import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import PropTypes from "prop-types";
import {
  Page,
  Card,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Divider,
  Modal,
  Checkbox,
  Select,
  IndexTable,
  Badge,
  Box,
  Banner,
  ChoiceList,
  useIndexResourceState,
} from "@shopify/polaris";

const PAGE_SIZE = 20;
const BULK_LIMIT = 20;

const parseGraphQLResponse = async (response) => {
  const json = await response.json();

  if (!response.ok || json?.errors?.length > 0) {
    const errorMessage = json?.errors
      ? json.errors.map((error) => error.message).join(" | ")
      : response.statusText;

    if (errorMessage.includes("Access denied for products field")) {
      throw new Error(
        "This app does not currently have product access for the installed shop. Sync the app scopes and reinstall or reauthorize the app so Shopify grants read_products.",
      );
    }

    throw new Error(`GraphQL error: ${errorMessage}`);
  }

  return json;
};

const getDefaultPageInfo = () => ({
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
});

const statusToneMap = {
  ACTIVE: "success",
  DRAFT: "attention",
  ARCHIVED: "critical",
};

const formatMetafieldsPreview = (metafields = []) => {
  if (!metafields.length) return "—";

  return metafields
    .map((metafield) => `${metafield.namespace}.${metafield.key}`)
    .join(", ");
};

const formatTagsPreview = (tags = []) => {
  if (!tags.length) return "—";
  return tags.slice(0, 3).join(", ");
};

const getPriceRange = (variants = []) => {
  const prices = variants
    .map((variant) => Number(variant.price))
    .filter((price) => !Number.isNaN(price));

  if (!prices.length) return "—";

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  if (min === max) return `${min}`;
  return `${min} - ${max}`;
};

const createHandle = (value = "") =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const mapProducts = (productEdges) =>
  productEdges.map((edge) => {
    const node = edge.node;
    const variants = node.variants?.nodes || [];
    const metafields = node.metafields?.nodes || [];

    return {
      id: node.id,
      title: node.title,
      handle: node.handle || "—",
      status: node.status,
      totalInventory: node.totalInventory,
      sku: variants?.[0]?.sku || "—",
      vendor: node.vendor || "—",
      productType: node.productType || "—",
      tags: node.tags || [],
      metafields,
      metafieldsPreview: formatMetafieldsPreview(metafields),
      tagsPreview: formatTagsPreview(node.tags || []),
      descriptionHtml: node.descriptionHtml || "",
      variantsCount: variants.length,
      priceRange: getPriceRange(variants),
    };
  });

const PRODUCT_LIST_QUERY = `#graphql
  query ProductList(
    $query: String,
    $first: Int,
    $last: Int,
    $after: String,
    $before: String
  ) {
    products(
      first: $first,
      last: $last,
      after: $after,
      before: $before,
      query: $query,
      sortKey: CREATED_AT,
      reverse: true
    ) {
      edges {
        cursor
        node {
          id
          title
          handle
          status
          totalInventory
          vendor
          productType
          tags
          descriptionHtml
          metafields(first: 5) {
            nodes {
              id
              namespace
              key
              type
              value
            }
          }
          variants(first: 10) {
            nodes {
              id
              sku
              price
              compareAtPrice
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const PRODUCT_DUPLICATE_MUTATION = `#graphql
  mutation ProductDuplicateForApp(
    $productId: ID!,
    $newTitle: String!,
    $newStatus: ProductStatus,
    $includeImages: Boolean,
    $synchronous: Boolean
  ) {
    productDuplicate(
      productId: $productId,
      newTitle: $newTitle,
      newStatus: $newStatus,
      includeImages: $includeImages,
      synchronous: $synchronous
    ) {
      newProduct {
        id
        title
        handle
        status
        tags
      }
      productDuplicateOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation ProductUpdateAfterDuplicate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        handle
        status
        tags
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_METAFIELDS_QUERY = `#graphql
  query ProductMetafieldsForDuplicate($id: ID!) {
    product(id: $id) {
      metafields(first: 100) {
        nodes {
          namespace
          key
        }
      }
    }
  }
`;

const METAFIELDS_DELETE_MUTATION = `#graphql
  mutation DeleteProductMetafields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        ownerId
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  query CollectionsForBulkDuplicate($first: Int!, $query: String) {
    collections(first: $first, query: $query, sortKey: TITLE) {
      nodes {
        id
        title
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query CollectionProductsForBulkDuplicate($id: ID!, $first: Int!) {
    collection(id: $id) {
      products(first: $first, sortKey: TITLE) {
        nodes {
          id
          title
        }
      }
    }
  }
`;

const BULK_SOURCE_PRODUCTS_QUERY = `#graphql
  query BulkSourceProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query, sortKey: TITLE) {
      nodes {
        id
        title
      }
    }
  }
`;

const throwUserErrors = (
  userErrors = [],
  fallbackMessage = "Shopify returned user errors.",
) => {
  if (!userErrors.length) return;

  const message = userErrors
    .map((error) => {
      const field = Array.isArray(error.field)
        ? error.field.join(".")
        : error.field;

      return field ? `${field}: ${error.message}` : error.message;
    })
    .join(" | ");

  throw new Error(message || fallbackMessage);
};

const removeProductMetafields = async ({ admin, productId }) => {
  const response = await admin.graphql(PRODUCT_METAFIELDS_QUERY, {
    variables: { id: productId },
  });

  const json = await parseGraphQLResponse(response);

  const metafields =
    json?.data?.product?.metafields?.nodes?.map((metafield) => ({
      ownerId: productId,
      namespace: metafield.namespace,
      key: metafield.key,
    })) || [];

  if (!metafields.length) return;

  const deleteResponse = await admin.graphql(METAFIELDS_DELETE_MUTATION, {
    variables: { metafields },
  });

  const deleteJson = await parseGraphQLResponse(deleteResponse);

  throwUserErrors(
    deleteJson?.data?.metafieldsDelete?.userErrors,
    "Metafields were copied but could not be removed.",
  );
};


const duplicateProductFast = async ({
  admin,
  productId,
  duplicateTitle,
  duplicateStatus,
  duplicateCount,
  includeImages,
  handleSuffix,
  addDuplicateTag,
  duplicateTagValue,
  copyMetafields,
}) => {
  const createdProducts = [];

  for (let index = 0; index < duplicateCount; index += 1) {
    const copyNumber = index + 1;

    const computedTitle =
      duplicateCount > 1
        ? `${duplicateTitle} ${copyNumber}`
        : duplicateTitle;

    const duplicateResponse = await admin.graphql(PRODUCT_DUPLICATE_MUTATION, {
      variables: {
        productId,
        newTitle: computedTitle,
        newStatus: duplicateStatus,
        includeImages,
        synchronous: true,
      },
    });

    const duplicateJson = await parseGraphQLResponse(duplicateResponse);
    const duplicatePayload = duplicateJson?.data?.productDuplicate;

    throwUserErrors(duplicatePayload?.userErrors, "Duplicate failed.");

    let createdProduct = duplicatePayload?.newProduct;

    if (!createdProduct?.id) {
      throw new Error("Duplicate failed. Shopify did not return a new product.");
    }

    if (!copyMetafields) {
      await removeProductMetafields({
        admin,
        productId: createdProduct.id,
      });
    }

    const updateInput = {
      id: createdProduct.id,
    };

    const cleanHandleSuffix = handleSuffix.trim();
    if (cleanHandleSuffix) {
      const baseHandle = createHandle(computedTitle);
      const suffixHandle = createHandle(cleanHandleSuffix);

      updateInput.handle =
        duplicateCount > 1
          ? `${baseHandle}-${suffixHandle}-${copyNumber}`
          : `${baseHandle}-${suffixHandle}`;
    }

    const cleanDuplicateTag = duplicateTagValue.trim();
    if (addDuplicateTag && cleanDuplicateTag) {
      const currentTags = createdProduct.tags || [];
      updateInput.tags = currentTags.includes(cleanDuplicateTag)
        ? currentTags
        : [...currentTags, cleanDuplicateTag];
    }

    if (Object.keys(updateInput).length > 1) {
      const updateResponse = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
        variables: {
          product: updateInput,
        },
      });

      const updateJson = await parseGraphQLResponse(updateResponse);
      const updatePayload = updateJson?.data?.productUpdate;

      throwUserErrors(
        updatePayload?.userErrors,
        "Duplicate was created, but update failed.",
      );

      createdProduct = updatePayload?.product || createdProduct;
    }

    createdProducts.push({
      id: createdProduct.id,
      title: createdProduct.title,
      handle: createdProduct.handle,
      status: createdProduct.status,
    });
  }

  return createdProducts;
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const [productsResponse, collectionsResponse] = await Promise.all([
    admin.graphql(PRODUCT_LIST_QUERY, {
      variables: {
        first: PAGE_SIZE,
        last: undefined,
        after: undefined,
        before: undefined,
        query: undefined,
      },
    }),
    admin.graphql(COLLECTIONS_QUERY, {
      variables: {
        first: 100,
        query: undefined,
      },
    }),
  ]);

  const productsJson = await parseGraphQLResponse(productsResponse);
  const collectionsJson = await parseGraphQLResponse(collectionsResponse);

  const productEdges = productsJson?.data?.products?.edges || [];
  const products = mapProducts(productEdges);
  const pageInfo =
    productsJson?.data?.products?.pageInfo || getDefaultPageInfo();

  const collections =
    collectionsJson?.data?.collections?.nodes?.map((collection) => ({
      label: collection.title,
      value: collection.id,
    })) || [];

  return {
    products,
    pageInfo,
    searchValue: "",
    collections,
  };
};

const resolveBulkSourceProductIds = async ({
  admin,
  bulkMode,
  selectedProductIds,
  bulkTagQuery,
  bulkProductTypeQuery,
  bulkCollectionId,
}) => {
  if (bulkMode === "selected") {
    return selectedProductIds || [];
  }

  if (bulkMode === "collection") {
    const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
      variables: {
        id: bulkCollectionId,
        first: BULK_LIMIT,
      },
    });

    const json = await parseGraphQLResponse(response);

    return (
      json?.data?.collection?.products?.nodes?.map((product) => product.id) ||
      []
    );
  }

  let query = "";

  if (bulkMode === "tag") {
    query = `tag:${bulkTagQuery}`;
  } else if (bulkMode === "product_type") {
    query = `product_type:${bulkProductTypeQuery}`;
  }

  if (!query) return [];

  const response = await admin.graphql(BULK_SOURCE_PRODUCTS_QUERY, {
    variables: {
      query,
      first: BULK_LIMIT,
    },
  });

  const json = await parseGraphQLResponse(response);

  return json?.data?.products?.nodes?.map((product) => product.id) || [];
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const actionType = formData.get("actionType")?.toString();

  if (actionType === "duplicate") {
    const bulkMode = formData.get("bulkMode")?.toString() || "selected";

    const selectedProductIds = JSON.parse(
      formData.get("selectedProductIds")?.toString() || "[]",
    );

    const bulkTagQuery = formData.get("bulkTagQuery")?.toString() || "";
    const bulkProductTypeQuery =
      formData.get("bulkProductTypeQuery")?.toString() || "";
    const bulkCollectionId =
      formData.get("bulkCollectionId")?.toString() || "";

    const duplicateTitle = formData.get("duplicateTitle")?.toString() || "";
    const duplicateStatus =
      formData.get("duplicateStatus")?.toString() || "DRAFT";
    const duplicateCount = Number(formData.get("duplicateCount") || "1");

    const copyImages = formData.get("copyImages") === "true";
    const copyMetafields = formData.get("copyMetafields") === "true";
    const handleSuffix = formData.get("handleSuffix")?.toString() || "";
    const addDuplicateTag = formData.get("addDuplicateTag") === "true";
    const duplicateTagValue =
      formData.get("duplicateTagValue")?.toString() || "";

    if (!duplicateTitle.trim()) {
      throw new Error("New product name is required.");
    }

    if (!duplicateCount || duplicateCount < 1) {
      throw new Error("Duplicate count must be at least 1.");
    }

    if (duplicateCount > 10) {
      throw new Error("Duplicate count cannot be more than 10 at once.");
    }

    const sourceProductIds = await resolveBulkSourceProductIds({
      admin,
      bulkMode,
      selectedProductIds,
      bulkTagQuery,
      bulkProductTypeQuery,
      bulkCollectionId,
    });

    if (!sourceProductIds.length) {
      throw new Error("No source products found for duplicate.");
    }

    const allCreatedProducts = [];

    for (const sourceProductId of sourceProductIds) {
      const createdProducts = await duplicateProductFast({
        admin,
        productId: sourceProductId,
        duplicateTitle: duplicateTitle.trim(),
        duplicateStatus,
        duplicateCount,
        includeImages: copyImages,
        handleSuffix,
        addDuplicateTag,
        duplicateTagValue,
        copyMetafields,
      });

      allCreatedProducts.push(...createdProducts);
    }

    return {
      success: true,
      message:
        allCreatedProducts.length === 1
          ? `Product duplicated successfully: ${allCreatedProducts[0].title}`
          : `${allCreatedProducts.length} products duplicated successfully`,
      duplicatedProducts: allCreatedProducts,
    };
  }

  if (actionType !== "search") {
    return {
      products: [],
      pageInfo: getDefaultPageInfo(),
      searchValue: "",
    };
  }

  const searchValue = (formData.get("search") || "").toString().trim();
  const direction = (formData.get("direction") || "first").toString();
  const cursor = (formData.get("cursor") || "").toString();

  let queryString = "";

  if (searchValue) {
    const escaped = searchValue.replace(/"/g, '\\"');
    queryString = `(title:*${escaped}*) OR (sku:*${escaped}*)`;
  }

  const variables = {
    query: queryString || undefined,
    first: direction === "previous" ? undefined : PAGE_SIZE,
    last: direction === "previous" ? PAGE_SIZE : undefined,
    after: direction === "previous" ? undefined : cursor || undefined,
    before: direction === "previous" ? cursor || undefined : undefined,
  };

  const response = await admin.graphql(PRODUCT_LIST_QUERY, { variables });
  const json = await parseGraphQLResponse(response);

  const productEdges = json?.data?.products?.edges || [];
  const products = mapProducts(productEdges);
  const pageInfo = json?.data?.products?.pageInfo || getDefaultPageInfo();

  return {
    products,
    pageInfo,
    searchValue,
  };
};

function DashboardSummary({ products }) {
  const totals = useMemo(() => {
    return {
      totalProducts: products.length,
      activeCount: products.filter((product) => product.status === "ACTIVE")
        .length,
      draftCount: products.filter((product) => product.status === "DRAFT")
        .length,
      archivedCount: products.filter(
        (product) => product.status === "ARCHIVED",
      ).length,
    };
  }, [products]);

  return (
    <InlineStack gap="300" wrap>
      <Card>
        <Box padding="300">
          <Text as="p" variant="headingMd">
            {totals.totalProducts}
          </Text>
          <Text as="p" tone="subdued">
            Products
          </Text>
        </Box>
      </Card>

      <Card>
        <Box padding="300">
          <Text as="p" variant="headingMd">
            {totals.activeCount}
          </Text>
          <Text as="p" tone="subdued">
            Active
          </Text>
        </Box>
      </Card>

      <Card>
        <Box padding="300">
          <Text as="p" variant="headingMd">
            {totals.draftCount}
          </Text>
          <Text as="p" tone="subdued">
            Draft
          </Text>
        </Box>
      </Card>

      <Card>
        <Box padding="300">
          <Text as="p" variant="headingMd">
            {totals.archivedCount}
          </Text>
          <Text as="p" tone="subdued">
            Archived
          </Text>
        </Box>
      </Card>
    </InlineStack>
  );
}

DashboardSummary.propTypes = {
  products: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      title: PropTypes.string,
      handle: PropTypes.string,
      status: PropTypes.string,
      totalInventory: PropTypes.number,
      sku: PropTypes.string,
      vendor: PropTypes.string,
      productType: PropTypes.string,
      tagsPreview: PropTypes.string,
      metafieldsPreview: PropTypes.string,
      variantsCount: PropTypes.number,
      priceRange: PropTypes.string,
    }),
  ).isRequired,
};

export default function Index() {
  const searchFetcher = useFetcher();
  const duplicateFetcher = useFetcher();
  const shopify = useAppBridge();
  const initialData = useLoaderData();

  const [searchValue, setSearchValue] = useState(
    initialData.searchValue || "",
  );

  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    setAppReady(true);
  }, []);

  const handledDuplicateRef = useRef(false);

  const prevSearchRef = useRef(initialData.searchValue || "");

  //const [setDashboardRefreshing] = useState(false);

  //const prevSearchRef = useRef("");

  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [duplicateStatus, setDuplicateStatus] = useState("DRAFT");
  const [handleSuffix, setHandleSuffix] = useState("copy");
  const [duplicateCount, setDuplicateCount] = useState("1");

  const [copyImages, setCopyImages] = useState(true);
  const [copyMetafields, setCopyMetafields] = useState(true);
  const [addDuplicateTag, setAddDuplicateTag] = useState(true);
  const [duplicateTagValue, setDuplicateTagValue] =
    useState("duplicated-by-app");

  const [bulkMode, setBulkMode] = useState("selected");
  const [bulkTagQuery, setBulkTagQuery] = useState("");
  const [bulkProductTypeQuery, setBulkProductTypeQuery] = useState("");
  const [bulkCollectionId, setBulkCollectionId] = useState("");

  const isSearching =
  searchFetcher.state !== "idle" &&
  searchFetcher.formData?.get("actionType") === "search";
  const isSubmittingDuplicate = duplicateFetcher.state !== "idle";
  const isLoading = isSearching || isSubmittingDuplicate;

  const data =
    searchFetcher.data && searchFetcher.data.products
      ? searchFetcher.data
      : initialData;

  const products = data.products || [];
  const pageInfo = data.pageInfo || getDefaultPageInfo();
  const collections = initialData.collections || [];

  const resourceIDs = products.map(({ id }) => ({ id }));

  const {
    selectedResources: indexTableSelectedResources,
    allResourcesSelected,
    handleSelectionChange,
  } = useIndexResourceState(resourceIDs);

  const selectedResources = selectedProduct
    ? [selectedProduct.id]
    : indexTableSelectedResources;


  useEffect(() => {
    const trimmed = searchValue.trim();

    if (trimmed === prevSearchRef.current) return;

    const timeout = setTimeout(() => {
      prevSearchRef.current = trimmed;

      const formData = new FormData();
      formData.set("actionType", "search");
      formData.set("search", trimmed);
      formData.set("direction", "first");
      formData.set("cursor", "");

      searchFetcher.submit(formData, { method: "post" });
    }, 350);

    return () => clearTimeout(timeout);
  }, [searchValue, searchFetcher]);

  useEffect(() => {
  if (duplicateFetcher.state !== "idle" || !duplicateFetcher.data) return;
  if (handledDuplicateRef.current) return;

  if (duplicateFetcher.data.success && duplicateFetcher.data.message) {
    handledDuplicateRef.current = true;

    shopify.toast.show(duplicateFetcher.data.message);

    setDuplicateModalOpen(false);
    setSelectedProduct(null);
    setSearchValue("");
    prevSearchRef.current = "";

    const formData = new FormData();
    formData.set("actionType", "search");
    formData.set("search", "");
    formData.set("direction", "first");
    formData.set("cursor", "");

    searchFetcher.submit(formData, { method: "post" });
  }
}, [duplicateFetcher.data, duplicateFetcher.state, searchFetcher, shopify]);

  const submitSearch = ({ direction = "first", cursor = "" } = {}) => {
    const formData = new FormData();
    formData.set("actionType", "search");
    formData.set("search", searchValue);
    formData.set("direction", direction);
    formData.set("cursor", cursor);

    searchFetcher.submit(formData, { method: "post" });
  };

  const resetDuplicateForm = (product = null) => {
    setSelectedProduct(product);
    setBulkMode("selected");
    setBulkTagQuery("");
    setBulkProductTypeQuery("");
    setBulkCollectionId("");
    setCopyMetafields(true);
    setDuplicateTitle(product ? `${product.title} - Copy` : "");
    setDuplicateStatus("DRAFT");
    setHandleSuffix("copy");
    setDuplicateCount("1");

    setCopyImages(true);
    setAddDuplicateTag(true);
    setDuplicateTagValue("duplicated-by-app");
  };

  const openDuplicateModal = (product) => {
    resetDuplicateForm(product);
    setDuplicateModalOpen(true);
  };

  const openBulkDuplicateModal = () => {
    resetDuplicateForm(null);
    setDuplicateModalOpen(true);
  };

  const closeDuplicateModal = () => {
    if (isSubmittingDuplicate) return;
    setDuplicateModalOpen(false);
    setSelectedProduct(null);
  };

  const submitDuplicate = () => {
    if (!duplicateTitle.trim()) {
      shopify.toast.show("New product name is required");
      return;
    }

    const count = Number(duplicateCount);

    if (!count || count < 1) {
      shopify.toast.show("Duplicate count must be at least 1");
      return;
    }

    if (count > 10) {
      shopify.toast.show("Duplicate count cannot be more than 10 at once");
      return;
    }

    if (bulkMode === "selected" && !selectedResources.length) {
      shopify.toast.show("Select at least one product");
      return;
    }

    if (bulkMode === "tag" && !bulkTagQuery.trim()) {
      shopify.toast.show("Tag is required");
      return;
    }

    if (bulkMode === "product_type" && !bulkProductTypeQuery.trim()) {
      shopify.toast.show("Product type is required");
      return;
    }

    if (bulkMode === "collection" && !bulkCollectionId) {
      shopify.toast.show("Collection is required");
      return;
    }

    const formData = new FormData();

    formData.set("actionType", "duplicate");
    formData.set("bulkMode", bulkMode);
    formData.set("selectedProductIds", JSON.stringify(selectedResources));
    formData.set("bulkTagQuery", bulkTagQuery.trim());
    formData.set("bulkProductTypeQuery", bulkProductTypeQuery.trim());
    formData.set("bulkCollectionId", bulkCollectionId);

    formData.set("duplicateTitle", duplicateTitle.trim());
    formData.set("duplicateStatus", duplicateStatus);
    formData.set("handleSuffix", handleSuffix.trim());
    formData.set("duplicateCount", duplicateCount);

    formData.set("copyImages", String(copyImages));
    formData.set("copyMetafields", String(copyMetafields));
    formData.set("addDuplicateTag", String(addDuplicateTag));
    formData.set("duplicateTagValue", duplicateTagValue.trim());
    handledDuplicateRef.current = false;
    duplicateFetcher.submit(formData, { method: "post" });
  };

  const rowMarkup = products.map((product, index) => (
    <IndexTable.Row
      id={product.id}
      key={product.id}
      position={index}
      selected={selectedResources.includes(product.id)}
    >
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {product.title}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            SKU: {product.sku}
          </Text>
        </BlockStack>
      </IndexTable.Cell>

      <IndexTable.Cell>{product.handle}</IndexTable.Cell>

      <IndexTable.Cell>
        <Badge tone={statusToneMap[product.status] || "info"}>
          {product.status}
        </Badge>
      </IndexTable.Cell>

      <IndexTable.Cell>{product.vendor}</IndexTable.Cell>
      <IndexTable.Cell>{product.productType}</IndexTable.Cell>
      <IndexTable.Cell>{product.priceRange}</IndexTable.Cell>
      <IndexTable.Cell>{product.totalInventory}</IndexTable.Cell>
      <IndexTable.Cell>{product.variantsCount}</IndexTable.Cell>

      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {product.tagsPreview}
        </Text>
      </IndexTable.Cell>

      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {product.metafieldsPreview}
        </Text>
      </IndexTable.Cell>

      <IndexTable.Cell>
        <Button size="slim" onClick={() => openDuplicateModal(product)}>
          Duplicate
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  if (!appReady) {

    return null;

  }

  return (
    <Box width="100%" margin="0 auto" position="relative">
      <Page
        title="Dashboard"
        subtitle="Browse products, inspect key product data, and duplicate products quickly."
      >
        <BlockStack gap="400">
          <DashboardSummary products={products} />

          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Product search
                    </Text>
                    <Text as="p" tone="subdued">
                      Search by title or SKU and manage duplicates from the
                      dashboard.
                    </Text>
                  </BlockStack>
                </InlineStack>

                <InlineStack gap="300" blockAlign="end" wrap>
                  <Box minWidth="320px" width="100%">
                    <TextField
                      label="Search by product title or SKU"
                      value={searchValue}
                      onChange={setSearchValue}
                      autoComplete="off"
                      placeholder="Type to search products instantly..."
                      loading={isSearching}
                    />
                  </Box>
                </InlineStack>
              </BlockStack>
            </Box>
          </Card>

          <Card padding="0">
            <BlockStack gap="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Products table
                    </Text>
                    <Text as="p" tone="subdued">
                      Newest products are shown first after duplicate.
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Box>

              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Select Product
                    </Text>
                  </BlockStack>

                  <Button variant="primary" onClick={openBulkDuplicateModal}>
                    Bulk duplicate
                  </Button>
                </InlineStack>
              </Box>

              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={products.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                selectable
                headings={[
                  { title: "Product" },
                  { title: "Handle" },
                  { title: "Status" },
                  { title: "Vendor" },
                  { title: "Type" },
                  { title: "Price" },
                  { title: "Inventory" },
                  { title: "Variants" },
                  { title: "Tags" },
                  { title: "Metafields" },
                  { title: "Action" },
                ]}
              >
                {rowMarkup}
              </IndexTable>

              <Box padding="400">
                <InlineStack align="space-between">
                  <Button
                    disabled={!pageInfo.hasPreviousPage || isLoading}
                    onClick={() =>
                      submitSearch({
                        direction: "previous",
                        cursor: pageInfo.startCursor || "",
                      })
                    }
                  >
                    Previous
                  </Button>

                  <Button
                    disabled={!pageInfo.hasNextPage || isLoading}
                    onClick={() =>
                      submitSearch({
                        direction: "next",
                        cursor: pageInfo.endCursor || "",
                      })
                    }
                  >
                    Next
                  </Button>
                </InlineStack>
              </Box>
            </BlockStack>
          </Card>
        </BlockStack>

        <Modal
          open={duplicateModalOpen}
          onClose={closeDuplicateModal}
          title={
            selectedProduct
              ? `Duplicate: ${selectedProduct.title}`
              : "Bulk duplicate"
          }
          primaryAction={{
            content: "Create duplicate",
            onAction: submitDuplicate,
            loading: isSubmittingDuplicate,
            disabled: isSubmittingDuplicate,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: closeDuplicateModal,
              disabled: isSubmittingDuplicate,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {bulkMode === "selected" && selectedProduct ? (
                <Card>
                  <Box padding="300">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Selected product
                      </Text>

                      <InlineStack gap="300" wrap>
                        <Text as="span" variant="bodySm">
                          <strong>Title:</strong> {selectedProduct.title}
                        </Text>
                        <Text as="span" variant="bodySm">
                          <strong>Handle:</strong> {selectedProduct.handle}
                        </Text>
                        <Text as="span" variant="bodySm">
                          <strong>SKU:</strong> {selectedProduct.sku}
                        </Text>
                        <Text as="span" variant="bodySm">
                          <strong>Status:</strong> {selectedProduct.status}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </Card>
              ) : null}

              <Banner tone="info">
                Shopify native duplication copies the product data quickly. You
                can control title, status, handle suffix, count, images, and a
                duplicate tag.
              </Banner>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Bulk source
                </Text>

                <ChoiceList
                  title="Duplicate products by"
                  titleHidden
                  choices={[
                    {
                      label: `Selected products (${selectedResources.length})`,
                      value: "selected",
                    },
                    { label: "Tag", value: "tag" },
                    { label: "Product type", value: "product_type" },
                    { label: "Collection", value: "collection" },
                  ]}
                  selected={[bulkMode]}
                  onChange={(value) => setBulkMode(value[0])}
                />

                {bulkMode === "tag" ? (
                  <TextField
                    label="Tag"
                    value={bulkTagQuery}
                    onChange={setBulkTagQuery}
                    autoComplete="off"
                    placeholder="Enter a product tag"
                    disabled={isLoading}
                  />
                ) : null}

                {bulkMode === "product_type" ? (
                  <TextField
                    label="Product type"
                    value={bulkProductTypeQuery}
                    onChange={setBulkProductTypeQuery}
                    autoComplete="off"
                    placeholder="Enter a product type"
                    disabled={isLoading}
                  />
                ) : null}

                {bulkMode === "collection" ? (
                  <Select
                    label="Collection"
                    options={[
                      { label: "Select collection", value: "" },
                      ...collections,
                    ]}
                    value={bulkCollectionId}
                    onChange={setBulkCollectionId}
                    disabled={isLoading}
                  />
                ) : null}
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Duplicate settings
                </Text>

                <TextField
                  label="New product name"
                  value={duplicateTitle}
                  onChange={setDuplicateTitle}
                  autoComplete="off"
                  disabled={isLoading}
                  helpText={
                    Number(duplicateCount) > 1
                      ? "Numbers will be added automatically, like 1, 2, 3."
                      : undefined
                  }
                />

                <InlineStack gap="300" wrap>
                  <Box minWidth="220px">
                    <Select
                      label="Product status"
                      options={[
                        { label: "Draft", value: "DRAFT" },
                        { label: "Active", value: "ACTIVE" },
                        { label: "Archived", value: "ARCHIVED" },
                      ]}
                      value={duplicateStatus}
                      onChange={setDuplicateStatus}
                      disabled={isLoading}
                    />
                  </Box>

                  <Box minWidth="220px">
                    <TextField
                      label="Handle suffix"
                      value={handleSuffix}
                      onChange={setHandleSuffix}
                      autoComplete="off"
                      disabled={isLoading}
                      helpText="Example: copy. Leave blank to use Shopify handle."
                    />
                  </Box>

                  <Box minWidth="140px">
                    <TextField
                      label="Duplicate count"
                      type="number"
                      value={duplicateCount}
                      onChange={setDuplicateCount}
                      autoComplete="off"
                      disabled={isLoading}
                      min={1}
                      max={10}
                    />
                  </Box>
                </InlineStack>

                <Checkbox
                  label="Copy images"
                  checked={copyImages}
                  onChange={setCopyImages}
                  disabled={isLoading}
                />

                <Checkbox
                  label="Copy metafields"
                  checked={copyMetafields}
                  onChange={setCopyMetafields}
                  disabled={isLoading}
                />

                <Checkbox
                  label="Add duplicate tag"
                  checked={addDuplicateTag}
                  onChange={setAddDuplicateTag}
                  disabled={isLoading}
                />

                <TextField
                  label="Duplicate tag value"
                  value={duplicateTagValue}
                  onChange={setDuplicateTagValue}
                  autoComplete="off"
                  disabled={isLoading || !addDuplicateTag}
                />
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </Page>
    </Box>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};