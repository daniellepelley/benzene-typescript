/** Port of Benzene.Azure.Function.CosmosDb.Extensions. */
import { IAzureFunctionApp } from '@benzenejs/azure-function-core';

/**
 * Dispatches a batch of changed documents — as delivered by the Azure Functions `CosmosDBTrigger`
 * binding — to the Azure Function app's Cosmos DB Change Feed entry point application for `TDocument`.
 * Port of C# `Extensions.HandleCosmosDbChanges<TDocument>(this IAzureFunctionApp,
 * IReadOnlyList<TDocument>)`. C# `IReadOnlyList<TDocument>` maps to `readonly TDocument[]`.
 *
 * @typeParam TDocument The document type the change feed batch was deserialized into.
 * @param source The built Azure Function app to dispatch to.
 * @param documents The changed documents to handle.
 */
export function handleCosmosDbChanges<TDocument>(
  source: IAzureFunctionApp,
  documents: readonly TDocument[],
): Promise<void> {
  return source.handleAsync(documents);
}
