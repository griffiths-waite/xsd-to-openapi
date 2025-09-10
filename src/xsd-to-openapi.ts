import { XMLParser } from "fast-xml-parser";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";

const openApiTypeMap = {
    string: "string",
    decimal: "number",
    float: "number",
    double: "number",
    integer: "integer",
    boolean: "boolean",
    date: "string",
    dateTime: "string",
    time: "string",
} as const;

type OpenApiType = keyof typeof openApiTypeMap;

export interface OpenApiSpec {
    openapi: string;
    info: {
        title: string;
        description: string;
        version: string;
    };
    paths: Record<string, PathItem>;
}

type PathItem = Partial<Record<HttpMethod, Operation>>;
interface SchemaProperty {
    type: string;
    items?: Schema;
    properties?: Record<string, SchemaProperty>;
    default?: string;
    fixed?: string;
    description?: string;
    required?: string[];
}

interface Schema {
    type?: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
    items?: Schema;
    oneOf?: Schema[];
    anyOf?: Schema[];
}

interface Operation {
    operationId?: string;
    tags?: string[];
    summary?: string;
    description?: string;
    deprecated?: boolean;
    requestBody?: {
        required: boolean;
        content: Record<string, { schema: Schema }>;
        description?: string;
    };
    responses: Record<
        string,
        {
            description?: string;
            content?: Record<string, { schema: Schema }>;
        }
    >;
}

interface XsdAnnotation {
    "xsd:appinfo"?: string | string[];
    "xs:appinfo"?: string | string[];
    "xsd:documentation"?: string | string[];
    "xs:documentation"?: string | string[];
}

interface BaseXsdElement {
    "xsd:annotation"?: XsdAnnotation[];
    "xs:annotation"?: XsdAnnotation[];
}

interface XsdImport extends BaseXsdElement {
    "@_namespace": string;
    "@_schemaLocation": string;
}

interface XsdElement extends BaseXsdElement {
    "@_name": string;
    "@_type"?: string;
    "@_maxOccurs"?: string;
    "@_minOccurs"?: string;
    "@_default"?: string;
    "@_fixed"?: string;
}

interface XsdSequence extends BaseXsdElement {
    "xsd:element"?: XsdElement[];
    "xsd:choice"?: XsdChoice[];
    "xs:element"?: XsdElement[];
    "xs:choice"?: XsdChoice[];
}

interface XsdChoice extends BaseXsdElement {
    "xsd:sequence"?: XsdSequence[];
    "xs:sequence"?: XsdSequence[];
    "xsd:element"?: XsdElement[];
    "xs:element"?: XsdElement[];
    "@_maxOccurs"?: string;
}

interface XsdComplexType extends BaseXsdElement {
    "@_name": string;
    "xsd:sequence"?: XsdSequence[];
    "xsd:choice"?: XsdChoice[];
    "xs:sequence"?: XsdSequence[];
    "xs:choice"?: XsdChoice[];
}

interface XsdSchema extends BaseXsdElement {
    "@_targetNamespace"?: string;
    "@_id"?: string;
    "xsd:complexType": XsdComplexType | XsdComplexType[];
    "xsd:simpleType"?: unknown | unknown[];
    "xsd:element": XsdElement | XsdElement[];
    "xsd:import"?: XsdImport[];
    "xs:complexType"?: XsdComplexType | XsdComplexType[];
    "xs:simpleType"?: unknown | unknown[];
    "xs:element"?: XsdElement | XsdElement[];
    "xs:import"?: XsdImport[];
    [key: string]: any; // Required for detecting xml namespace prefixes
}

interface XsdObject {
    "xsd:schema"?: XsdSchema;
    "xs:schema"?: XsdSchema;
}

type ErrorSchemaOptions = (
    | { errorSchemaFilePath: string; errorSchemaContent?: never }
    | { errorSchemaContent: string; errorSchemaFilePath?: never }
) & {
    errorStatusCode: string;
    errorDescription?: string;
    errorTypeName?: string;
};

type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

export interface XsdToOpenApiConfig {
    inputFilePath?: string;
    outputFilePath?: string;
    schemaName?: string;
    xsdContent?: string;
    specGenerationOptions?: SpecGeneratorOptions;
}

/**
 * Convert an XSD schema (either from a file or a string) into an OpenAPI 3.0 spec
 * and receive the OpenAPI spec as a JSON file.
 *
 * @returns The generated OpenAPI spec as a JSON object (for programmatic use).
 *
 * @param inputFilePath - Path to the input XSD file. If not provided, xsdContent must be provided.
 * @param outputFilePath - Path to the output OpenAPI JSON file.
 * @param xsdContent - Optional XSD content as a string. If provided, inputFilePath is ignored.
 * @param schemaName - Optional name for the schema. If not provided, it will be derived from the input file name.
 * @param specGenerationOptions - Options for generating the OpenAPI spec.
 * @param specGenerationOptions.requestSuffix - Suffix for request elements. Default is "Req".
 * @param specGenerationOptions.responseSuffix - Suffix for response elements. Default is "Res".
 * @param specGenerationOptions.useSchemaNameInPath - Whether to use the schema name in the path. Default is false.
 * @param specGenerationOptions.httpMethod - HTTP method for the operation. Default is "post".
 * @param specGenerationOptions.openApiSpecDescription - Description for the OpenAPI spec.
 * @param specGenerationOptions.contentType - Content type for the request and response. Default is "application/json".
 * @param specGenerationOptions.defaultType - Default type for elements. Default is "string".
 * @param specGenerationOptions.error - Error schema options.
 * @param specGenerationOptions.error.errorSchemaFilePath - Path to the error schema XSD file (mutually exclusive with errorSchemaContent).
 * @param specGenerationOptions.error.errorSchemaContent - Error schema XSD content as string (mutually exclusive with errorSchemaFilePath).
 * @param specGenerationOptions.error.errorStatusCode - HTTP status code for the error response.
 * @param specGenerationOptions.error.errorDescription - Description for the error response schema.
 * @param specGenerationOptions.error.errorTypeName - Optional name of the error type to use look for in the XSD schema.
 */
export async function xsdToOpenApi({
    inputFilePath,
    outputFilePath,
    xsdContent,
    schemaName,
    specGenerationOptions,
}: XsdToOpenApiConfig) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        isArray: (name: string): boolean => {
            const arrayElements = [
                "xsd:element",
                "xsd:complexType",
                "xsd:simpleType",
                "xsd:attribute",
                "xsd:sequence",
                "xsd:choice",
                "xsd:import",
                "xs:element",
                "xs:complexType",
                "xs:simpleType",
                "xs:attribute",
                "xs:sequence",
                "xs:choice",
                "xs:import",
            ];
            return arrayElements.includes(name);
        },
    });

    try {
        if (!inputFilePath && !xsdContent) {
            throw new Error("An input file path or XSD content must be provided");
        }

        if (inputFilePath && !existsSync(inputFilePath)) {
            throw new Error("Input file not found");
        }

        const xsdObj: XsdObject = inputFilePath
            ? parser.parse(await readFile(inputFilePath, "utf8"))
            : parser.parse(xsdContent || "");

        const xsdSchema = xsdObj["xsd:schema"] || xsdObj["xs:schema"];

        if (!xsdSchema) throw new Error("No XSD schema found");

        const specName = schemaName || basename(inputFilePath as string, ".xsd");

        const generatedSpec = await generateOpenApiSpec(
            xsdSchema,
            specName.toLowerCase(),
            inputFilePath as string,
            parser,
            specGenerationOptions || {},
        );

        const openApiSpec = JSON.stringify(generatedSpec, undefined, 2);

        if (outputFilePath) {
            if (!existsSync(outputFilePath)) await mkdir(dirname(outputFilePath), { recursive: true });

            await writeFile(outputFilePath, openApiSpec, { flag: "w+" });
        }

        return generatedSpec;
    } catch (error) {
        throw error;
    }
}

type ImportedSchemasMap = Record<string, XsdSchema>;

function resolveReferencedSchema(
    xsdSchema: XsdSchema,
    typeName: string,
    resolvedTypes = new Set<string>(),
    defaultType: OpenApiType,
    importedSchemas?: ImportedSchemasMap,
): Schema {
    if (resolvedTypes.has(typeName)) {
        return { type: "object", properties: {} }; // Break circular references
    }

    resolvedTypes.add(typeName);
    return generateSchema({ xsdSchema, typeName, resolvedTypes, importedSchemas, defaultType });
}

function getChoiceElements(choice: XsdChoice): XsdElement[] {
    const nestedSeq = choice["xsd:sequence"]?.[0] || choice["xs:sequence"]?.[0];
    if (nestedSeq) {
        return nestedSeq["xsd:element"] || nestedSeq["xs:element"] || [];
    }
    return choice["xsd:element"] || choice["xs:element"] || [];
}

function getSequenceElements(sequence: XsdSequence): XsdElement[] {
    return sequence["xsd:element"] || sequence["xs:element"] || [];
}

function addXsdElementToSchema(
    element: XsdElement,
    openApiSchema: Schema,
    xsdSchema: XsdSchema,
    defaultType: OpenApiType,
    importedSchemas?: ImportedSchemasMap,
    resolvedTypes = new Set<string>(),
) {
    const subElementName = element["@_name"];
    const elementMaxOccurs = element["@_maxOccurs"];
    const { prefix, typeName: elementType } = resolveType(defaultType, element["@_type"]);

    let propertySchema: Schema | SchemaProperty;

    if (prefix && importedSchemas?.[prefix]) {
        propertySchema = resolveReferencedSchema(
            importedSchemas[prefix],
            elementType,
            resolvedTypes,
            defaultType,
            importedSchemas,
        );
    } else if (!prefix && elementType) {
        const formattedElement = elementType.replace("xsd:", "").replace("xs:", "");
        const mappedElement = openApiTypeMap[formattedElement as OpenApiType];
        propertySchema = mappedElement
            ? { type: mappedElement }
            : resolveReferencedSchema(xsdSchema, elementType, resolvedTypes, defaultType, importedSchemas);
    } else {
        propertySchema = { type: defaultType };
    }

    const property: SchemaProperty =
        elementMaxOccurs === "unbounded"
            ? { type: "array", items: propertySchema }
            : (propertySchema as SchemaProperty);

    const min = element["@_minOccurs"] || null;

    if (!min || min === "1") {
        openApiSchema.required = openApiSchema.required || [];
        if (property.type !== "array") openApiSchema.required.push(subElementName);
    }

    const elementDescription =
        element["xsd:annotation"]?.[0]?.["xsd:documentation"]?.[0] ||
        element["xs:annotation"]?.[0]?.["xs:documentation"]?.[0];

    if (elementDescription) property.description = elementDescription;
    if (element["@_default"]) property.default = element["@_default"];
    if (element["@_fixed"]) property.fixed = element["@_fixed"];

    openApiSchema.properties = openApiSchema.properties || {};
    openApiSchema.properties[subElementName] = property;
}

type GenerateSchemaParams = {
    xsdSchema: XsdSchema;
    typeName: string;
    resolvedTypes?: Set<string>;
    importedSchemas?: ImportedSchemasMap;
    defaultType: OpenApiType;
};

function extractComplexTypes(xsdSchema: XsdSchema): XsdComplexType[] {
    const rawComplexTypes = xsdSchema["xsd:complexType"] || xsdSchema["xs:complexType"];
    return rawComplexTypes ? (Array.isArray(rawComplexTypes) ? rawComplexTypes : [rawComplexTypes]) : [];
}

function generateSchema({
    xsdSchema,
    typeName,
    resolvedTypes = new Set<string>(),
    importedSchemas,
    defaultType,
}: GenerateSchemaParams) {
    const complexTypes: XsdComplexType[] = extractComplexTypes(xsdSchema);
    const complexType = complexTypes.find((ct) => ct["@_name"] === typeName);

    if (!complexType) {
        return { type: defaultType };
    }

    const sequence = complexType["xsd:sequence"]?.[0] || complexType["xs:sequence"]?.[0];
    const choice = complexType["xsd:choice"]?.[0] || complexType["xs:choice"]?.[0];

    const sequenceElements = sequence ? getSequenceElements(sequence) : [];
    const choiceElements = choice ? getChoiceElements(choice) : [];

    if (sequenceElements.length === 0 && choiceElements.length === 0) {
        return { type: defaultType };
    }

    const sequenceSchema = sequenceElements.reduce(
        (acc, element) => {
            addXsdElementToSchema(element, acc, xsdSchema, defaultType, importedSchemas, resolvedTypes);
            return acc;
        },
        { type: "object", properties: {} } as Schema,
    );

    if (choiceElements.length === 0) {
        return sequenceSchema;
    }

    const choiceType = choice?.["@_maxOccurs"] === "unbounded" ? "anyOf" : "oneOf";

    const choiceSchemas = choiceElements.map((element) => {
        const openApiSchema = { type: "object", properties: {} };
        addXsdElementToSchema(element, openApiSchema, xsdSchema, defaultType, importedSchemas, resolvedTypes);
        return openApiSchema;
    });

    return { [choiceType]: choiceSchemas };
}

type NamespacePrefixMap = Map<string, { prefix: string }>;

function extractElementTypePrefixes(xsdSchema: XsdSchema) {
    const prefixes: NamespacePrefixMap = new Map();
    const xmlNamespaceTag = "@_xmlns:";

    Object.keys(xsdSchema).forEach((key) => {
        if (key.startsWith(xmlNamespaceTag)) {
            const prefix = key.slice(xmlNamespaceTag.length);

            // Avoid adding reserved XML namespace prefixes
            if (prefix !== "xsd" && prefix !== "xs") {
                prefixes.set(xsdSchema[key], { prefix });
                // Key is set to the namespace URI, value is the namsepace prefix
            }
        }
    });

    return prefixes;
}

async function getImportedSchemas(
    xsdImports: XsdImport[] | undefined,
    inputFilePath: string,
    parser: XMLParser,
    elementTypePrefixes: NamespacePrefixMap,
) {
    const importedSchemas: ImportedSchemasMap = {};

    if (!xsdImports || xsdImports.length === 0 || !inputFilePath) return;

    await Promise.all(
        xsdImports.map(async (xsdImport) => {
            const namespacePrefix = elementTypePrefixes.get(xsdImport["@_namespace"])?.prefix || "";

            if (namespacePrefix) {
                const importFileName = xsdImport["@_schemaLocation"].endsWith(".xsd")
                    ? xsdImport["@_schemaLocation"]
                    : `${xsdImport["@_schemaLocation"]}.xsd`;
                const importFilePath = join(dirname(inputFilePath), importFileName);

                const parsedXsd = parser.parse(await readFile(importFilePath, "utf8"));

                const importedSchema = parsedXsd["xsd:schema"] || parsedXsd["xs:schema"];

                if (importedSchema) {
                    importedSchemas[namespacePrefix] = importedSchema;
                } else {
                    throw new Error(`Invalid XSD schema: No schema found in ${importFilePath}`);
                }
            }
        }),
    );

    return importedSchemas;
}

function resolveType(defaultType: OpenApiType, rawType?: XsdElement["@_type"]) {
    if (!rawType) return { typeName: "string" };

    if (rawType.startsWith("tns:")) {
        return { typeName: rawType.slice(4) };
    }

    const typeParts = rawType.split(":");
    if (typeParts.length === 2 && typeParts[0] !== "xsd" && typeParts[0] !== "xs") {
        return { prefix: typeParts[0], typeName: typeParts[1] || defaultType };
    }

    return { typeName: rawType };
}

interface SpecGeneratorOptions {
    requestSuffix?: string;
    responseSuffix?: string;
    useSchemaNameInPath?: boolean;
    httpMethod?: HttpMethod;
    openApiSpecDescription?: string;
    contentType?: string;
    defaultType?: OpenApiType;
    error?: ErrorSchemaOptions;
}

async function generateOpenApiSpec(
    xsdSchema: XsdSchema,
    schemaName: string,
    inputFilePath: string,
    parser: XMLParser,
    options: SpecGeneratorOptions,
) {
    const {
        requestSuffix = "Req",
        responseSuffix = "Res",
        error,
        httpMethod = "post",
        contentType = "application/json",
        defaultType = "string",
        openApiSpecDescription,
        useSchemaNameInPath = false,
    } = options;

    const specDescription =
        openApiSpecDescription || `OpenAPI 3.1.0 specification generated from XSD schema ${schemaName}`;

    const openApiSpec: OpenApiSpec = {
        openapi: "3.1.0",
        info: {
            title: schemaName,
            description: specDescription,
            version: "1.0.0",
        },
        paths: {},
    };

    const importedSchemas = await getImportedSchemas(
        xsdSchema["xsd:import"] || xsdSchema["xs:import"],
        inputFilePath,
        parser,
        extractElementTypePrefixes(xsdSchema),
    );

    const rawElements = xsdSchema["xsd:element"] || xsdSchema["xs:element"];
    const validElements = Array.isArray(rawElements) ? rawElements : [rawElements].filter((element) => element);

    const groupedElements = validElements.reduce(
        (acc, element) => {
            const elementName = element["@_name"];
            let pathName = elementName;
            let isRequest = false;
            let isResponse = false;

            if (requestSuffix && elementName.endsWith(requestSuffix)) {
                pathName = elementName.substring(0, elementName.length - requestSuffix.length);
                isRequest = true;
            }

            if (responseSuffix && elementName.endsWith(responseSuffix)) {
                const potentialPathName = elementName.substring(0, elementName.length - responseSuffix.length);

                if (!isRequest || potentialPathName === pathName) {
                    pathName = potentialPathName;
                }

                isResponse = true;
            }

            if (isRequest || isResponse) {
                if (!acc[pathName]) acc[pathName] = {};
                if (isRequest) acc[pathName].request = element;
                if (isResponse) acc[pathName].response = element;
            }

            return acc;
        },
        {} as Record<string, { request?: XsdElement; response?: XsdElement }>,
    );

    for (const [pathName, { request, response }] of Object.entries(groupedElements)) {
        if (!request && !response) continue;

        const openApiPathName = useSchemaNameInPath ? `/${schemaName}/${pathName}` : `/${pathName}`;

        const operation: Operation = {
            operationId: pathName,
            summary: `${httpMethod.toUpperCase()} ${openApiPathName}`,
            responses: {},
        };

        if (request) {
            const requestDescription =
                request["xsd:annotation"]?.[0]?.["xsd:documentation"]?.[0] ||
                request["xs:annotation"]?.[0]?.["xs:documentation"]?.[0];

            operation.requestBody = {
                required: request["@_minOccurs"] !== "0",
                description: requestDescription,
                content: {
                    [contentType]: {
                        schema: generateSchema({
                            xsdSchema,
                            typeName: resolveType(defaultType, request["@_type"]).typeName,
                            defaultType,
                            importedSchemas,
                        }),
                    },
                },
            };
        }

        if (response) {
            const responseDescription =
                response["xsd:annotation"]?.[0]?.["xsd:documentation"]?.[0] ||
                response["xs:annotation"]?.[0]?.["xs:documentation"]?.[0];

            operation.responses["200"] = {
                description: responseDescription,
                content: {
                    [contentType]: {
                        schema: generateSchema({
                            xsdSchema,
                            typeName: resolveType(defaultType, response["@_type"]).typeName,
                            defaultType,
                            importedSchemas,
                        }),
                    },
                },
            };
        }

        if (error) {
            let errorXsdSchema: XsdSchema | undefined;

            try {
                if (error?.errorSchemaContent) {
                    const parsedErrorXsdContent = parser.parse(error.errorSchemaContent) as XsdObject;
                    errorXsdSchema = parsedErrorXsdContent["xsd:schema"] || parsedErrorXsdContent["xs:schema"];
                } else if (error?.errorSchemaFilePath) {
                    if (existsSync(error.errorSchemaFilePath)) {
                        const errorXsdFile = await readFile(error.errorSchemaFilePath, "utf8");
                        const parsedErrorXsdFile = parser.parse(errorXsdFile) as XsdObject;
                        errorXsdSchema = parsedErrorXsdFile["xsd:schema"] || parsedErrorXsdFile["xs:schema"];
                    } else {
                        throw new Error(`Error schema file not found: ${error.errorSchemaFilePath}`);
                    }
                }
            } catch (error) {
                throw new Error(`Failed to parse error schema: ${error}`);
            }

            if (errorXsdSchema) {
                const complexTypes = extractComplexTypes(errorXsdSchema);
                const typeName = error?.errorTypeName ?? complexTypes[0]?.["@_name"];

                operation.responses[error.errorStatusCode] = {
                    description: error.errorDescription || "Error response",
                    content: {
                        [contentType]: {
                            schema: generateSchema({
                                xsdSchema: errorXsdSchema,
                                typeName,
                                defaultType,
                            }),
                        },
                    },
                };
            }
        }

        openApiSpec.paths[openApiPathName] = { [httpMethod]: operation };
    }

    return openApiSpec;
}
